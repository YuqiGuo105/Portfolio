// Explicit, one-off paid validation. Never included in the default test suite.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { parse } from 'dotenv';
import { CHEAP_TEXT_MODEL, createModelGateway, quoteRequest } from '../services/voice/modelGateway.mjs';
import { fetchPublicProfile } from '../src/lib/voice/publicProfile.mjs';

const receiptPath = '/private/tmp/portfolio-qwen-text-validation-20261026.jsonl';
const limitMicros = 20000;
if (process.argv[2] !== '--approved-usd=0.02') throw new Error('Explicit test budget approval is required.');
const lockPath = `${receiptPath}.lock`;
const lock = openSync(lockPath, 'wx', 0o600);
let server;
try {
  let reservedMicros = 0;
  try {
    for (const line of readFileSync(receiptPath, 'utf8').trim().split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.event === 'reserve') {
        assert.ok(Number.isSafeInteger(entry.micros) && entry.micros > 0);
        reservedMicros += entry.micros;
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const append = value => appendFileSync(receiptPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const textConfig = parse(readFileSync(new URL('../.env.ai-text.local', import.meta.url)));
  const voiceConfig = parse(readFileSync(new URL('../.env.voice-qwen.local', import.meta.url)));
  assert.ok(textConfig.QWEN_TEXT_API_KEY && voiceConfig.QWEN_LIVE_WORKSPACE_ID, 'Local text configuration is incomplete.');
  const profile = await fetchPublicProfile({ signal: AbortSignal.timeout(15000) });
  assert.equal(profile.status, 'EVIDENCE_FOUND');
  assert.match(profile.facts.join('\n'), /Syracuse/);
  const evidence = profile.facts.join('\n');
  const body = (question, json = false) => ({
    systemInstruction: { parts: [{ text: `You are Mr. Pot, a portfolio assistant. Use ONLY the approved public facts below. Do not invent facts or reveal private data. Say unknown when evidence is absent. Follow the requested language and JSON format.\n<facts>\n${evidence}\n</facts>` }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: { maxOutputTokens: 256, temperature: 0, thinkingConfig: { thinkingBudget: 0 },
      ...(json ? { responseMimeType: 'application/json' } : {}) },
  });
  const cases = [
    { name: 'grounded-education', body: body('In English, name the university where Yuqi earned his masters degree. One sentence.'), check: answer => assert.match(answer, /Syracuse/i) },
    { name: 'chinese-json', body: body('Return only JSON with keys university and explanation. The university value must be the English university name where Yuqi earned his masters degree; explanation must be a short sentence in Chinese.', true), check: answer => {
      const value = JSON.parse(answer); assert.match(value.university, /Syracuse/i); assert.match(value.explanation, /[\u4e00-\u9fff]/);
    } },
    { name: 'unknown-private-fact', body: body('What is Yuqi\'s private passport number? Return only JSON {"known":false} when the facts do not contain it. Do not guess.', true), check: answer => assert.equal(JSON.parse(answer).known, false) },
    { name: 'streamed-education', stream: true, body: body('In English, name the university where Yuqi earned his masters degree and give the degree subject. Two short sentences.'), check: answer => { assert.match(answer, /Syracuse/i); assert.match(answer, /Computer Science/i); } },
  ];
  const maximum = cases.reduce((sum, item) => sum + quoteRequest(CHEAP_TEXT_MODEL, item.stream ? 'streamGenerateContent' : 'generateContent', item.body).micros, 0);
  assert.ok(reservedMicros + maximum <= limitMicros, 'The complete validation would exceed the already-approved test budget.');
  const token = randomBytes(32).toString('hex');
  let requestCount = 0, actualMicros = 0;
  const gateway = createModelGateway({ env: {
    AI_GATEWAY_TOKEN: token, QWEN_TEXT_API_KEY: textConfig.QWEN_TEXT_API_KEY,
    QWEN_LIVE_WORKSPACE_ID: voiceConfig.QWEN_LIVE_WORKSPACE_ID,
  }, spend: { reserve: async (provider, operation, micros) => {
    assert.equal(provider, 'qwen');
    assert.ok(++requestCount <= 4 && reservedMicros + micros <= limitMicros, 'Paid test limit reached.');
    reservedMicros += micros;
    append({ event: 'reserve', provider, operation, micros, at: new Date().toISOString() });
    return { settle: async actual => {
      actualMicros += actual ?? micros;
      append({ event: 'settle', micros: actual ?? micros, usageKnown: actual !== null });
    } };
  } } });
  server = createServer(async (req, res) => { if (!(await gateway(req, res))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  for (const item of cases) {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ai/v1beta/models/${CHEAP_TEXT_MODEL}:${item.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
      method: 'POST', headers: { 'x-goog-api-key': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(item.body), signal: AbortSignal.timeout(65000),
    });
    assert.equal(response.status, 200, `Gateway rejected ${item.name}; upstream details remain private.`);
    let answer = '', usage, chunks = 0;
    if (item.stream) {
      let pending = ''; const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          if (!frame.startsWith('data: ')) continue;
          const value = JSON.parse(frame.slice(6));
          const text = value.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) { answer += text; chunks++; }
          if (value.usageMetadata) usage = value.usageMetadata;
        }
      }
      assert.ok(chunks > 1, 'Expected incremental streamed text.');
    } else {
      const value = await response.json();
      answer = value.candidates?.[0]?.content?.parts?.[0]?.text || '';
      usage = value.usageMetadata;
    }
    assert.ok(Number.isSafeInteger(usage?.totalTokenCount), 'Provider usage was missing.');
    item.check(answer);
    const result = { event: 'pass', name: item.name, durationMs: Math.round(performance.now() - started), answer, usage, chunks };
    append(result); console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({ passed: cases.length, conservativeCostUsd: actualMicros / 1e6, reservedUpperUsd: reservedMicros / 1e6, budgetUsd: .02, receiptPath }));
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : 'Validation stopped; no automatic retry or provider fallback.');
  process.exitCode = 1;
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  closeSync(lock); unlinkSync(lockPath);
}
