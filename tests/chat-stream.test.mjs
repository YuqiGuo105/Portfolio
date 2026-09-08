import test from 'node:test'
import assert from 'node:assert/strict'
import { postSSE } from '../src/lib/chatStream.mjs'

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
