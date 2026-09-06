import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

assert.equal(process.env.RUN_LIVE_DICTATION_TEST, '1', 'Explicit opt-in required: this test calls the real transcription provider.');
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3062';
// Accept either Chinese script while checking that the complete phrase survives.
for (const [name, pattern] of [['zh', /系统架构|系統架構/], ['en', /duplicate messages/i]]) {
  const response = await fetch(`${base}/api/rag/transcribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': name === 'zh' ? 'en-US' : 'zh-CN' },
    body: JSON.stringify({audio: (await readFile(`/private/tmp/dictation-${name}.wav`)).toString('base64')}),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, 200, `Transcription ${name}: HTTP ${response.status}`);
  const result = await response.json();
  assert.match(result.text, pattern);
  console.log(JSON.stringify({language: name, transcript: result.text, realProvider: true}));
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({channel: 'chrome', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--use-file-for-fake-audio-capture=/private/tmp/dictation-mixed.wav',
]});
try {
  const context = await browser.newContext({permissions: ['microphone'], locale: 'en-US', viewport: {width: 390, height: 900}});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${base}/?openChat=1`, {waitUntil: 'domcontentloaded'});
  const input = page.locator('textarea[aria-label="Message input"]');
  await input.fill('Draft:');
  await page.getByRole('button', {name: 'Voice input', exact: true}).click();
  await page.getByText('Recording', {exact: true}).waitFor();
  await page.waitForTimeout(4600);
  await page.getByRole('button', {name: 'Finish recording', exact: true}).click();
  await input.waitFor({state: 'visible'});
  const transcript = await input.inputValue();
  await page.screenshot({path: '/private/tmp/multilingual-dictation-live.png'});
  assert.match(transcript, /^Draft:/);
  assert.match(transcript, /你好|请解释|請解釋/);
  assert.match(transcript, /Redis/i);
  assert.match(transcript, /Java/i);
  console.log(JSON.stringify({language: 'mixed', transcript, realMediaRecorder: true, realProvider: true, syntheticMicrophone: true}));
} finally { await browser.close(); }
