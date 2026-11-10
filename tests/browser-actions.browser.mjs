import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3144';
const artifacts = '/private/tmp/mr-pot-interaction-check';
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text().slice(0, 200)); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // No paid calls, telemetry writes, mail, location lookup or real conversation creation.
    await context.route('**/api/**', route => route.request().url().includes('/api/architecture/evolution')
      ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], projects: [], count: 0, flags: [], pulses: [], peers: [] }) }));
    let calls = 0;
    await context.route('**/answer/stream', route => {
      calls++;
      const events = [
        { stage: 'safety_check', status: 'completed', durationMs: 15, payload: { internalReasoning: 'MUST_NOT_APPEAR' } },
        { stage: 'routing', status: 'completed', durationMs: 45 },
        { stage: 'browser_actions', payload: { schemaVersion: 1, autoStart: true, actions: [
          { type: 'open_project', projectId: '7c3715bf-7722-4df5-9e83-5d7e9493ea2c' },
          { type: 'diagram_step', flow: 'publish-content', step: 4 },
          { type: 'diagram_step', flow: 'publish-content', step: 5 },
        ] } },
        { stage: 'answer_final', payload: { answer: 'Here is the publication workflow.' } },
        { stage: 'done' },
      ];
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
    });
    await page.goto(`${base}/mr-pot-lab`, { waitUntil: 'networkidle' });
    await page.getByText('Execution record', { exact: false }).last().click();
    await page.screenshot({ path: `${artifacts}/lab-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole('button', { name: 'Publishing, step 3', exact: true }).click();
    await page.getByRole('button', { name: 'Run on page' }).click();
    console.log('Action submitted', width);
    await page.waitForURL('**/architecture#flows/publish-content');
    await page.getByText('Step 3 / 15', { exact: true }).waitFor();
    assert.equal(await page.getByText('INSERT outbox event', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Next step', exact: true }).click();
    await page.getByText('Step 4 / 15', { exact: true }).waitFor();
    await page.screenshot({ path: `${artifacts}/diagram-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.locator('.launch-button').click();
    await page.locator('.bot-container textarea').fill('Show me the publishing workflow');
    await page.locator('.bot-container textarea').press('Enter');
    await page.getByText('Step 5 / 15', { exact: true }).waitFor();
    await page.locator('.bot-container').getByText('Here is the publication workflow.', { exact: true }).waitFor();
    assert.equal(await page.locator('.bot-container').getByText('Project page requested', { exact: true }).count(), 1);
    assert.equal(await page.locator('.bot-container').getByText('Publish Article: step 4', { exact: true }).count(), 1);
    assert.equal(await page.locator('.bot-container').getByText('Publish Article: step 5', { exact: true }).count(), 1);
    await page.locator('.bot-container').getByText('Execution record', { exact: false }).click();
    assert.equal(await page.locator('.bot-container').getByText('MUST_NOT_APPEAR', { exact: false }).count(), 0);
    assert.equal(calls, 1);
    await page.screenshot({ path: `${artifacts}/chat-${width}.png`, fullPage: false });
    await page.evaluate(() => {
      const messages = JSON.parse(localStorage.getItem('chatMessages'));
      messages.push({ id: 'guide-answer-fixture', role: 'assistant', content: 'Education fixture: Syracuse University.',
        showGuideCta: true, guideCopy: 'Explore the education section.', streaming: false });
      localStorage.setItem('chatMessages', JSON.stringify(messages));
    });
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.locator('.launch-button').isVisible()) await page.locator('.launch-button').click();
    await page.locator('.bot-container').getByText('Here is the publication workflow.', { exact: true }).waitFor();
    await page.locator('.bot-container').getByRole('button', { name: 'Run on page' }).waitFor();
    await page.locator('.bot-container').getByText('Education fixture: Syracuse University.', { exact: true }).waitFor();
    await page.getByText('Step 1 / 15', { exact: true }).waitFor();
    assert.equal(calls, 1, 'Restoring history must not call the agent or auto-run old actions');
    await page.getByRole('button', { name: 'Minimize chat', exact: true }).click();
    await page.goto(`${base}/mr-pot-lab`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Terminal: projects' }).click();
    await page.getByRole('button', { name: 'Run on page' }).click();
    await page.getByRole('dialog', { name: 'Site terminal' }).waitFor();
    await page.getByText('visitor@yuqi.site:~$ ls projects', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close terminal' }).click();
    await page.goto(`${base}/mr-pot-lab`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Globe: Tokyo', exact: true }).click();
    await page.getByRole('button', { name: 'Run on page' }).click();
    await page.waitForURL('**/analytics');
    await page.locator('.lg-notice').filter({ hasText: 'Tokyo' }).waitFor();
    const canvas = page.locator('.live-globe canvas').first();
    await canvas.waitFor();
    const globeImage = await canvas.screenshot({ path: `${artifacts}/globe-${width}.png` });
    const pixelColors = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const surface = document.createElement('canvas');
      surface.width = image.width; surface.height = image.height;
      const context = surface.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, surface.width, surface.height).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 64) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    }, globeImage.toString('base64'));
    assert.ok(pixelColors > 50, `Globe must render nonblank pixels, got ${pixelColors} colors`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.goto(`${base}/mr-pot-lab`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Portfolio Platform', exact: true }).click();
    await page.getByRole('button', { name: 'Run on page' }).click();
    await page.waitForURL('**/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c');
    await page.getByRole('heading', { name: 'Portfolio Platform', exact: true }).first().waitFor();
    await page.goto(`${base}/mcp/connect?access=public&client=chatgpt`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Open ChatGPT', exact: true }).waitFor();
    assert.equal(await page.getByText('https://www.yuqi.site/mcp', { exact: true }).count(), 1);
    await page.screenshot({ path: `${artifacts}/connect-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: diagram, project, globe (${pixelColors} colors), terminal, replay, public connector`);
  }
  const response = await fetch(`${base}/api/architecture/evolution`);
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.ok(history.milestones.some(item => item.type === 'incident'));
  console.log(`PASS architecture API: ${history.milestones.length} source-backed milestones`);
} finally { await browser.close(); }
