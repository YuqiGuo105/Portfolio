import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { postSSE } from '../src/lib/chatStream.mjs'
import { chatRequestError, failAssistantMessage, chatStepsLabel } from '../src/lib/chatErrors.mjs'
import * as errors from '../src/lib/chatErrors.mjs'

function response(chunks, close = true) {
  return new Response(new ReadableStream({ start(c) {
    for (const text of chunks) c.enqueue(new TextEncoder().encode(text))
    if (close) c.close()
  } }))
}
test('terminal callback finishes even when server never closes the connection', async () => {
  let calls = 0
  await postSSE('/stream', {}, { fetchImpl: async () => response(['data: {"stage":"answer_final"}\n\n'], false),
    onEvent: () => { calls++; return false } })
  assert.equal(calls, 1)
})
test('flushes final event without trailing blank line and handles split CRLF', async () => {
  const events = []
  await postSSE('/stream', {}, { fetchImpl: async () => response(['data: 1\r', '\n\r\ndata: 2']), onEvent: e => events.push(e.data) })
  assert.deepEqual(events, ['1', '2'])
})
test('empty EOF and DONE complete without hanging', async () => {
  for (const chunks of [[], ['data: [DONE]\n\n']]) {
    await postSSE('/stream', {}, { fetchImpl: async () => response(chunks) })
  }
})
test('application errors propagate and reader is released', async () => {
  await assert.rejects(postSSE('/stream', {}, { fetchImpl: async () => response(['data: error\n\n'], false), onEvent: () => { throw new Error('failed') } }), /failed/)
})
test('deadline and user stop abort a pending request', async () => {
  const pending = (_, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  await assert.rejects(postSSE('/stream', {}, { fetchImpl: pending, timeoutMs: 20 }), { name: 'TimeoutError' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(postSSE('/stream', {}, { fetchImpl: pending, signal: controller.signal }), { name: 'AbortError' })
})

test('HTTP budget failures preserve the safe code, never raw provider details', async () => {
  for (const code of ['AI_BUDGET_PAUSED', 'AI_BUDGET_EXHAUSTED', 'AI_BUDGET_UNAVAILABLE']) {
    await assert.rejects(postSSE('/stream', {}, {
      fetchImpl: async () => Response.json({ code, error: 'secret-provider-key-in-url' }, { status: 429 }),
    }), error => error.code === code && !error.message.includes('secret-provider'))
  }
})

test('oversized and non-JSON HTTP failures are bounded and sanitized', async () => {
  for (const body of ['<html>provider-secret</html>', JSON.stringify({ code: 'AI_BUDGET_PAUSED', error: 'x'.repeat(5000) })]) {
    await assert.rejects(postSSE('/stream', {}, { fetchImpl: async () => new Response(body, { status: 503 }) }),
      error => error.code === 'AI_SERVICE_UNAVAILABLE' && !error.message.includes('provider-secret'))
  }
})

test('typed SSE errors close streams without displaying failure as completed', async () => {
  let failure
  await assert.rejects(postSSE('/stream', {}, {
    fetchImpl: async () => response(['data: {"stage":"error","payload":{"code":"AI_ROUTING_UNAVAILABLE","message":"private"}}\n\n'], false),
    onEvent: event => { const data = JSON.parse(event.data); throw chatRequestError(data.payload) },
  }), error => { failure = error; return error.code === 'AI_ROUTING_UNAVAILABLE' })
  const original = { content: '', streaming: true, executionStages: [
    { stage: 'connecting', status: 'completed', tsEnd: 10 }, { stage: 'routing', status: 'started' },
  ] }
  const failed = failAssistantMessage(original, failure, 20)
  assert.equal(failed.streaming, false)
  assert.equal(failed.executionStages[0].status, 'completed')
  assert.equal(failed.executionStages[1].status, 'failed')
  assert.equal(failed.executionStages[1].tsEnd, 20)
  assert.equal(original.executionStages[1].status, 'started')
  assert.equal(chatStepsLabel(2, Boolean(failed.errorCode)), 'Request failed')
  assert.equal(chatStepsLabel(1, false), 'Completed 1 step')
  assert.doesNotMatch(failed.content, /private|rephrase|clarify/)
})

test('the pinned Next SWC output reads split HTTP error bodies before releasing the reader', async () => {
  const require = createRequire(import.meta.url)
  const swc = require('next/dist/build/swc')
  const source = await readFile(new URL('../src/lib/chatStream.mjs', import.meta.url), 'utf8')
  const compiled = await swc.transform(source, {
    filename: 'chatStream.mjs', jsc: { parser: { syntax: 'ecmascript' }, target: 'es5' },
    module: { type: 'commonjs' },
  })
  const exports = {}
  vm.runInNewContext(compiled.code, { exports, module: { exports },
    require: id => { assert.equal(id, './chatErrors.mjs'); return errors },
    TextDecoder, AbortController, DOMException, setTimeout, clearTimeout })
  await assert.rejects(exports.postSSE('/stream', {}, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) {
      for (const text of ['{"code":', '"AI_BUDGET_PAUSED"}']) controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  }), { status: 429 }) }), error => error.code === 'AI_BUDGET_PAUSED')
})
