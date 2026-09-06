import assert from 'node:assert/strict';
import { encodeWav } from '../src/lib/dictationAudio.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3071';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('PAGE ERROR', e.message));
    const wav = Buffer.from(encodeWav(Float32Array.from({length: 16000}, (_, i) => Math.sin(i / 10) * .1))).toString('base64');
    await page.addInitScript(wav => {
      window.__recorders = [];
      window.__tracks = [];
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async () => {
        if (window.__denyMicrophone) throw new DOMException('Denied', 'NotAllowedError');
        const track = { stop() { this.stopped = true; } };
        window.__tracks.push(track);
        return { getTracks: () => [track] };
      }});
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; window.__recorders.push(this); }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({data: new Blob([Uint8Array.from(atob(wav), c => c.charCodeAt(0))], {type: 'audio/wav'})});
          this.onstop?.();
        }
      };
    }, wav);
    let uploads = 0, deletes = 0, grant = 0, transcriptions = 0;
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/rag/transcribe') {
        const body = request.postDataJSON();
        assert.deepEqual(Object.keys(body), ['audio']);
        const bytes = Buffer.from(body.audio, 'base64');
        assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
        assert.equal(bytes.readUInt32LE(24), 16000);
        transcriptions++;
        return route.fulfill({json: {text: transcriptions === 1 ? 'Please summarize my file.' : '请总结附件。'}});
      }
      if (url.pathname.endsWith('/attachments/upload-url')) return route.fulfill({ json: { attachmentId: `test-${++grant}`, mimeType: 'text/plain', uploadUrl: `${base}/fixture-upload` } });
      if (url.pathname === '/fixture-upload') {
        uploads++;
        assert.equal(request.postDataBuffer().toString(), 'Synthetic upload fixture.');
        return route.fulfill({ json: { status: 'READY' } });
      }
      if (url.pathname.includes('/attachments/') && request.method() === 'DELETE') {
        deletes++;
        return route.fulfill({ status: 204 });
      }
      if (url.pathname.endsWith('/api/intent/route')) return route.fulfill({ json: { routeKind: 'GENERAL_CHAT' } });
      if (url.pathname.endsWith('/answer/stream')) return route.fulfill({ contentType: 'text/event-stream', body: 'event: answer_final\ndata: {"payload":{"answer":"Fixture analyzed."}}\n\n' });
      if (url.hostname.endsWith('supabase.co') && request.method() !== 'GET') return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' });
    console.log('Loaded', page.url(), (await page.locator('body').innerText()).slice(0, 160));
    await page.screenshot({path: '/private/tmp/chat-input-debug.png'});
    const input = page.locator('textarea[aria-label="Message input"]');
    await input.fill('Existing draft.');
    console.log('Composer ready', width);
    await page.getByRole('button', { name: 'Voice input', exact: true }).click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', {name: 'Voice input', exact: true}).getByRole('combobox').count(), 0);
    assert.equal(await page.getByRole('textbox', {name: 'Voice transcript'}).count(), 0);
    assert.equal(await input.inputValue(), 'Existing draft.');
    await page.getByRole('button', { name: 'Finish recording', exact: true }).click();
    await input.waitFor({state: 'visible'});
    assert.equal(await input.inputValue(), 'Existing draft. Please summarize my file.');
    console.log('Voice inserted', width);
    await page.getByRole('button', { name: 'Voice input', exact: true }).click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    await page.getByText('Recording', {exact: true}).waitFor();
    await page.screenshot({ path: `/private/tmp/chat-voice-${width}.png` });
    await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
    await page.evaluate(() => { window.__denyMicrophone = true; });
    await page.getByRole('button', { name: 'Voice input', exact: true }).click();
    await page.getByRole('alert').filter({hasText: 'Allow microphone access'}).waitFor();
    assert.equal(await page.evaluate(() => window.__tracks.every(track => track.stopped)), true);
    await page.evaluate(() => { window.__denyMicrophone = false; });
    await page.getByRole('button', { name: 'Try recording again', exact: true }).click();
    await page.getByText('Recording', {exact: true}).waitFor();
    await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__tracks.every(track => track.stopped)), true);
    assert.equal(await input.inputValue(), 'Existing draft. Please summarize my file.');
    await page.getByRole('button', { name: 'Voice input', exact: true }).click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    await page.evaluate(() => window.__recorders.at(-1).stop());
    await input.waitFor({state: 'visible'});
    assert.equal(await input.inputValue(), 'Existing draft. Please summarize my file. 请总结附件。');
    const fixture = { name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic upload fixture.') };
    await page.locator('#__chat_widget_root input[type=file]').setInputFiles(fixture);
    console.log('File chosen', width);
    await page.getByRole('button', { name: 'Remove file', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove file', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.cw-chip').length === 0);
    await page.locator('#__chat_widget_root input[type=file]').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Remove file', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Fixture analyzed.', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(uploads, 2);
    assert.equal(deletes, 2);
    assert.equal(transcriptions, 2);
    console.log(JSON.stringify({ width, uploads, deletes, voiceDraftPreserved: true, microphoneAbortedOnClose: true, fixtureOnly: true }));
    await page.close();
  }
} finally { await browser.close(); }
