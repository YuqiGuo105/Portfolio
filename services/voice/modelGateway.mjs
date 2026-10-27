import { timingSafeEqual } from 'node:crypto';
import { createSpendGuard, SpendDenied } from '../../src/lib/voice/spendGuard.mjs';
import { transcribeQwen, DictationError, readDictationWav } from '../../src/lib/voice/qwenDictation.mjs';
import { QWEN_MODEL } from '../../src/lib/voice/qwenProtocol.mjs';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const count = value => Number.isSafeInteger(value) && value >= 0;
export const CHEAP_TEXT_MODEL = 'qwen3.7-flash-2026-07-15';

export function dictationAudio(body, operation) {
  if (operation !== 'generateContent' || !body || Array.isArray(body)
    || Object.keys(body).some(key => !['systemInstruction', 'contents', 'generationConfig'].includes(key))
    || body.contents?.length !== 1 || body.contents[0].role !== 'user'
    || body.contents[0].parts?.length !== 1) throw new DictationError('invalid_audio', 400);
  const part = body.contents[0].parts[0];
  if (Object.keys(part).length !== 1 || part.inlineData?.mimeType !== 'audio/wav'
    || Object.keys(part.inlineData).some(key => !['mimeType', 'data'].includes(key))) throw new DictationError('invalid_audio', 400);
  readDictationWav(part.inlineData.data);
  return part.inlineData.data;
}

export function quoteRequest(model, operation, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SpendDenied('unsupported_request');
  const config = body.generationConfig || {};
  if (typeof config !== 'object' || Array.isArray(config)
    || (body.model && body.model !== model && body.model !== `models/${model}`)
    || (body.contents && !Array.isArray(body.contents))) throw new SpendDenied('unsupported_request');
  const allowedRoot = new Set(['systemInstruction', 'contents', 'generationConfig', 'content', 'model', 'taskType', 'outputDimensionality', 'title']);
  const allowedConfig = new Set(['maxOutputTokens', 'temperature', 'thinkingConfig', 'responseMimeType', 'responseSchema']);
  if (Object.keys(body).some(key => !allowedRoot.has(key)) || Object.keys(config).some(key => !allowedConfig.has(key))
    || Object.keys(config.thinkingConfig || {}).some(key => key !== 'thinkingBudget')) throw new SpendDenied('unsupported_request');
  // Fail closed for features whose token expansion/extra fees are not bounded.
  if (body.tools?.length || body.cachedContent || config.candidateCount > 1 || config.responseModalities?.some(x => x !== 'TEXT')) throw new SpendDenied('unsupported_request');
  const parts = [...(body.systemInstruction?.parts || []), ...(body.contents || []).flatMap(x => x.parts || []), ...(body.content?.parts || [])];
  let audio = false;
  for (const part of parts) {
    if (typeof part.text === 'string' && Object.keys(part).every(x => x === 'text')) continue;
    const data = part.inlineData;
    if (model !== 'gemini-2.5-flash-lite' || !data || data.mimeType !== 'audio/wav' || typeof data.data !== 'string'
      || Object.keys(part).length !== 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) throw new SpendDenied('unsupported_input');
    const wav = Buffer.from(data.data, 'base64');
    if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
      || wav.toString('ascii', 12, 16) !== 'fmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1
      || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt32LE(28) !== 32000
      || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data'
      || wav.readUInt32LE(40) !== wav.length - 44 || wav.length > 32000 * 60 + 44) throw new SpendDenied('unsupported_audio');
    audio = true;
  }
  const inputBound = Buffer.byteLength(JSON.stringify(body)) + 4096;
  const embedding = operation === 'embedContent';
  const outputBound = embedding ? 0 : config.maxOutputTokens;
  if (!count(outputBound) || (!embedding && outputBound < 1) || outputBound > 4096 || inputBound > 3000000) throw new SpendDenied('unbounded_request');
  if (!embedding && config.thinkingConfig?.thinkingBudget !== 0) throw new SpendDenied('unbounded_thinking');
  let provider, inputRate, outputRate;
  if (model === CHEAP_TEXT_MODEL && !embedding) { provider = 'qwen'; inputRate = .20; outputRate = .80; }
  else if (model === 'gemini-2.5-flash-lite' && !embedding) { provider = 'google'; inputRate = audio ? .30 : .10; outputRate = .40; }
  else if (model === 'gemini-embedding-2' && embedding) { provider = 'google'; inputRate = .20; outputRate = 0; }
  else throw new SpendDenied('unpriced_model');
  // UTF-8 bytes plus framing is deliberately an upper estimate, not chars/4.
  return { provider, micros: Math.ceil((inputBound * inputRate + (outputBound + 32) * outputRate) * 1.25), inputRate, outputRate };
}

export function qwenRequest(body, stream) {
  const text = parts => (parts || []).map(part => {
    if (typeof part.text !== 'string') throw new SpendDenied('unsupported_input');
    return part.text;
  }).join('\n');
  const messages = [];
  if (body.systemInstruction) messages.push({ role: 'system', content: text(body.systemInstruction.parts) });
  for (const content of body.contents || []) {
    if (!['user', 'model'].includes(content.role)) throw new SpendDenied('unsupported_role');
    messages.push({ role: content.role === 'model' ? 'assistant' : 'user', content: text(content.parts) });
  }
  if (!messages.length || body.generationConfig?.responseSchema) throw new SpendDenied('unsupported_request');
  return { model: CHEAP_TEXT_MODEL, messages, enable_thinking: false,
    max_completion_tokens: body.generationConfig.maxOutputTokens,
    temperature: body.generationConfig.temperature ?? .2, stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(body.generationConfig.responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
  };
}

function qwenResult(value, streaming) {
  const choice = value.choices?.[0];
  const text = streaming ? choice?.delta?.content : choice?.message?.content;
  const usage = value.usage;
  return {
    ...(choice ? { candidates: [{ content: { role: 'model', parts: [{ text: text || '' }] },
      ...(choice.finish_reason ? { finishReason: choice.finish_reason === 'stop' ? 'STOP' : 'MAX_TOKENS' } : {}) }] } : {}),
    ...(usage ? { usageMetadata: { promptTokenCount: usage.prompt_tokens, candidatesTokenCount: usage.completion_tokens, totalTokenCount: usage.total_tokens } } : {}),
    modelVersion: CHEAP_TEXT_MODEL,
  };
}

export function createModelGateway({ env = process.env, fetchImpl = fetch, spend = createSpendGuard({ env, fetchImpl }), transcribe = transcribeQwen } = {}) {
  return async function http(req, res) {
    if (!req.url?.startsWith('/ai/v1beta/')) return false;
    let reservation, finalUsage, complete = false, quote, settled = false, providerStarted = false;
    const settle = async () => {
      if (!reservation || settled) return;
      settled = true;
      let actual = providerStarted ? null : 0;
      if (complete && count(finalUsage?.promptTokenCount) && count(finalUsage?.totalTokenCount)
        && finalUsage.totalTokenCount >= finalUsage.promptTokenCount) {
        // Conservative pricing includes all output/thinking tokens. An
        // incomplete provider response retains the entire reservation.
        actual = Math.ceil(finalUsage.promptTokenCount * quote.inputRate
          + (finalUsage.totalTokenCount - finalUsage.promptTokenCount) * quote.outputRate);
      }
      try { await reservation.settle(actual); }
      catch { /* Storage failure retains the durable reservation. */ }
    };
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', disconnect);
    try {
      const secret = env.AI_GATEWAY_TOKEN;
      if (!secret || secret.length < 32 || !equal(req.headers['x-goog-api-key'], secret)) { json(res, 401, { error: 'Unauthorized.' }); return true; }
      const match = /^\/ai\/v1beta\/models\/([a-z0-9.-]+):(generateContent|streamGenerateContent|embedContent)(\?alt=sse)?$/.exec(req.url);
      if (req.method !== 'POST' || !match) { json(res, 404, { error: 'Not found.' }); return true; }
      const [, model, operation] = match;
      const stream = operation === 'streamGenerateContent';
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 2700000) throw new SpendDenied('request_too_large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (model === QWEN_MODEL) {
        // Keep the Java transcription contract; this path only recognizes
        // speech and never requests an answer or stores audio.
        const audio = dictationAudio(body, operation);
        const result = await transcribe(audio, { env, spend, signal: abort.signal });
        if (!res.destroyed) json(res, 200, { candidates: [{ content: { role: 'model',
          parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }], modelVersion: QWEN_MODEL });
        return true;
      }
      quote = quoteRequest(model, operation, body);
      let url, headers, request;
      if (quote.provider === 'qwen') {
        const workspace = env.QWEN_LIVE_WORKSPACE_ID;
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(workspace || '') || !env.QWEN_TEXT_API_KEY) throw new SpendDenied('provider_not_configured');
        url = `https://${workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
        headers = { Authorization: `Bearer ${env.QWEN_TEXT_API_KEY}` };
        request = qwenRequest(body, stream);
      } else {
        if (!env.GEMINI_API_KEY) throw new SpendDenied('provider_not_configured');
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${operation}${stream ? '?alt=sse' : ''}`;
        headers = { 'x-goog-api-key': env.GEMINI_API_KEY };
        request = body;
      }
      reservation = await spend.reserve(quote.provider, `${model}:${operation}`, quote.micros);
      if (abort.signal.aborted) throw new Error('Disconnected');
      providerStarted = true;
      const upstream = await fetchImpl(url, { method: 'POST', redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
        headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      if (!upstream.ok) throw new Error('Provider rejected');
      const observe = value => {
        if (value.error) throw new Error('Provider error');
        const output = quote.provider === 'qwen' ? qwenResult(value, stream) : value;
        if (output.usageMetadata) {
          const usage = output.usageMetadata;
          if (!count(usage.promptTokenCount) || !count(usage.totalTokenCount)
            || usage.totalTokenCount < usage.promptTokenCount) throw new Error('Invalid usage');
          if (!finalUsage || usage.totalTokenCount >= finalUsage.totalTokenCount) finalUsage = usage;
        }
        return output;
      };
      if (!stream) {
        let bytes = 0; const chunks = [];
        for await (const chunk of upstream.body) { bytes += chunk.length; if (bytes > 2e6) throw new Error('Response too large'); chunks.push(chunk); }
        const output = observe(JSON.parse(Buffer.concat(chunks).toString()));
        complete = true;
        await settle();
        json(res, 200, output);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        let pending = '', total = 0;
        const decoder = new TextDecoder();
        for await (const chunk of upstream.body) {
          total += chunk.length;
          if (total > 2e6 || res.writableLength > 256000) throw new Error('Response too large');
          pending += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
          let boundary;
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            if (data === '[DONE]') { complete = true; continue; }
            const output = observe(JSON.parse(data));
            if (output.candidates?.[0]?.finishReason) complete = true;
            res.write(`data: ${JSON.stringify(output)}\n\n`);
          }
        }
        // Truncated frames are not proof of complete billing metadata.
        if (pending.trim()) complete = false;
        // Keep the request open while accounting, including on throttled hosts.
        await settle();
        res.end();
      }
    } catch (error) {
      complete = false;
      await settle();
      if (!res.headersSent) json(res, error instanceof SpendDenied ? 429 : error instanceof DictationError ? error.status : 502, { error: 'AI usage is temporarily unavailable.', code: error instanceof SpendDenied ? error.reason : error instanceof DictationError ? error.code : 'provider_unavailable' });
      else res.destroy();
    } finally {
      abort.abort();
      res.off('close', disconnect);
      await settle();
    }
    return true;
  };
}
