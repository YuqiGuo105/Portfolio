import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { describeLink, linkRow, linkRows, looksLikeUrl, readableUrl } from '../src/components/chat/linkMeta.mjs';
import { formatCost, formatMs, researchRecord, runSteps, runTotals } from '../src/lib/chatRunSummary.mjs';
import { fileKind, fileSize } from '../src/components/chat/fileMeta.mjs';

const pipeline = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
const firstList = async markdown => (await pipeline.run(pipeline.parse(markdown))).children.find(node => node.tagName === 'ul' || node.tagName === 'ol');

test('a bullet list of profile links becomes aligned rows with the right icon and a readable address', async () => {
  const rows = linkRows(await firstList([
    '- **GitHub:** https://github.com/YuqiGuo105',
    '- **LeetCode:** https://leetcode.com/u/SY0JvhmwHK/',
    '- **Instagram:** https://www.instagram.com/yuqi_guo17/',
    '- LinkedIn：[profile](https://www.linkedin.com/in/y-guo-6080733a5/)',
  ].join('\n')));
  assert.deepEqual(rows.map(row => [row.kind, row.title, row.detail, row.external]), [
    ['github', 'GitHub', 'github.com/YuqiGuo105', true],
    ['leetcode', 'LeetCode', 'leetcode.com/u/SY0JvhmwHK', true],
    ['instagram', 'Instagram', 'instagram.com/yuqi_guo17', true],
    ['linkedin', 'LinkedIn', 'profile', true],
  ]);
});

test('named links to site pages keep their name and say what kind of page they open', async () => {
  const rows = linkRows(await firstList([
    '- [Portfolio Platform](https://www.yuqi.site/work-single/7c3715bf) — publishing, search and AI retrieval',
    '- [GitHub Operations in Practice](https://www.yuqi.site/blog-single/df9bed8e)',
    '- [hello@example.com](mailto:hello@example.com)',
  ].join('\n')));
  assert.deepEqual(rows.map(row => [row.kind, row.title, row.detail, row.external]), [
    ['project', 'Portfolio Platform', 'publishing, search and AI retrieval', false],
    ['article', 'GitHub Operations in Practice', 'yuqi.site', false],
    ['email', 'hello@example.com', '', true],
  ]);
});

test('prose that merely contains a link stays prose, and one such bullet keeps the whole list a list', async () => {
  const sentence = '- The relay publishes to Kafka and, when a delivery fails, retries before giving up; see the [design notes](https://www.yuqi.site/architecture).';
  assert.equal(linkRows(await firstList(sentence)), null);
  assert.equal(linkRows(await firstList(`- **GitHub:** https://github.com/YuqiGuo105\n${sentence}`)), null);
  assert.equal(linkRows(await firstList('- [one](https://a.example) and [two](https://b.example)')), null);
  assert.equal(linkRows(await firstList('- no link here')), null);
  // Numbered steps keep their numbers even when every step is a link.
  assert.equal(linkRows(await firstList('1. [First](https://a.example)\n2. [Second](https://b.example)')), null);
  assert.equal(linkRow({ type: 'element', tagName: 'p', children: [] }), null);
});

test('link descriptions never show a protocol, a query string or an opaque id', () => {
  assert.equal(readableUrl('https://www.github.com/YuqiGuo105/?tab=repositories#x'), 'github.com/YuqiGuo105');
  assert.ok(readableUrl('https://example.org/' + 'a'.repeat(120)).length <= 44);
  assert.deepEqual(describeLink('/architecture'), { kind: 'page', name: 'Architecture', address: 'yuqi.site/architecture', external: false });
  assert.deepEqual(describeLink('https://yuqi.site/'), { kind: 'page', name: 'Home page', address: 'yuqi.site', external: false });
  assert.equal(describeLink('https://www.yuqi.site/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c').address, 'yuqi.site');
  assert.equal(describeLink('https://docs.example.org/guide').name, 'docs.example.org');
  assert.equal(describeLink('tel:+15550100').kind, 'phone');
  assert.equal(describeLink('javascript:alert(1)').kind, 'web');
  assert.equal(looksLikeUrl('https://github.com/x'), true);
  assert.equal(looksLikeUrl('my GitHub'), false);
});

test('the record under an answer prefers the public execution record and never invents numbers', () => {
  const message = {
    publicRunEvents: [
      { stage: 'safety_check', label: 'Input safety', status: 'completed', durationMs: 620, inputTokens: null, outputTokens: null, costUsd: null },
      { stage: 'generation', label: 'Generation', status: 'completed', durationMs: 1360, inputTokens: 4675, outputTokens: 169, costUsd: 0.000535 },
      { stage: 'output_safety', label: 'Output safety', status: 'started', durationMs: null },
    ],
    executionStages: [{ id: 'a', stage: 'connecting', ts: 1000, tsEnd: 1400 }, { id: 'b', stage: 'generation', ts: 1400, tsEnd: 4500 }],
    toolCards: [{ id: 't1', toolName: 'search_content', durationMs: 412, tsEnd: 2 }],
  };
  const steps = runSteps(message);
  assert.deepEqual(steps.map(step => [step.label, step.status, step.durationMs]), [
    ['Input safety', 'completed', 620], ['Generation', 'completed', 1360], ['Output safety', 'incomplete', null], ['search_content', 'completed', 412],
  ]);
  assert.equal(steps[3].tool, true);
  // Wall time comes from the browser's own clock; step times are not summed (some steps overlap).
  assert.deepEqual(runTotals(message, steps), { wallMs: 3500, inputTokens: 4675, outputTokens: 169, costUsd: 0.000535, failed: false });
  assert.equal(runSteps({ ...message, streaming: true })[2].status, 'running');
});

test('without a public record the browser-side stages are listed, and a failed turn says so', () => {
  const message = { errorCode: 'AI_SERVICE_UNAVAILABLE', executionStages: [
    { id: 'c', stage: 'connecting', status: 'completed', ts: 0, tsEnd: 10 },
    { id: 'r', stage: 'routing', title: 'Routing…', status: 'completed', ts: 10, tsEnd: 500 },
    { id: 'g', stage: 'generation', status: 'failed', ts: 500, tsEnd: 900 },
  ] };
  const steps = runSteps(message, stage => stage.toUpperCase());
  assert.deepEqual(steps.map(step => [step.label, step.status, step.durationMs]), [['ROUTING', 'completed', 490], ['GENERATION', 'failed', 400]]);
  const totals = runTotals(message, steps);
  assert.equal(totals.failed, true);
  assert.equal(totals.costUsd, null);
  assert.equal(totals.inputTokens, null);
  assert.deepEqual(runSteps({}), []);
  assert.equal(runTotals({}, []).wallMs, null);
  assert.equal(formatMs(620), '620 ms');
  assert.equal(formatMs(1360), '1.4 s');
  assert.equal(formatMs(75000), '1 min 15 s');
  assert.equal(formatMs(null), '');
  assert.equal(formatCost(0.000535), '$0.0005');
  assert.equal(formatCost(null), '');
});

test('answer styles stay inside the widget, load last and respect reduced motion', () => {
  const css = readFileSync(new URL('../styles/chatWidgetAnswer.css', import.meta.url), 'utf8');
  const sheet = postcss.parse(css);
  const root = '#__chat_widget_root#__chat_widget_root';
  sheet.walkRules(rule => {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'keyframes') return;
    for (const selector of rule.selectors) assert.ok(selector.includes(root), selector);
    assert.doesNotMatch(rule.selector, /avatar|mr-pot/i);
  });
  assert.doesNotMatch(css, /url\(|@import/);
  let reduced = false;
  sheet.walkAtRules('media', rule => { if (rule.params.includes('prefers-reduced-motion')) reduced = true; });
  assert.ok(reduced);
  // The site theme draws a large quotation mark before every blockquote.
  const quotes = {};
  sheet.walkRules(rule => { if (rule.selector.includes('.cw-source-quote::before')) rule.walkDecls(d => { quotes[d.prop] = d.value; }); });
  assert.equal(quotes.display, 'none');
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('styles/chatWidgetAnswer.css') > app.indexOf('styles/chatWidgetModern.css'));
});

test('the guide is one message, not a card under every answer', () => {
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  // A reply that has its own text offers the guide on its action line; the card is kept for the
  // welcome and for a reply that is only the offer.
  assert.ok(widget.includes('m.showGuideCta && !answerOffersGuide(m) ?'));
  assert.ok(widget.includes('guide={answerOffersGuide(m) ?'));
  assert.match(widget, /function answerOffersGuide\(message\) \{\s+if \(!message\.showGuideCta \|\| !message\.guidePlan\) return false/);
  // One line under the answer replaces the three stacked disclosures.
  assert.ok(widget.includes('<AnswerFooter'));
  assert.ok(!widget.includes('Run details</summary>'));
  assert.ok(!widget.includes('<RunReplay') && !widget.includes('<AnswerSources'));
});

test('a Deep answer lists its steps while it works and keeps them in the record afterwards', () => {
  const working = { streaming: true,
    planPayload: { subtasks: [{ text: 'Find what the site says', status: 'complete' }, 'Write the answer', { name: ' ' }, null] },
    reasoningSteps: [
      { label: 'Searching the portfolio', detail: '4 documents', completed: true },
      { label: 'Reading the sources', completed: false },
      { label: '', completed: true },
    ] };
  const record = researchRecord(working);
  assert.deepEqual(record.steps, [
    { label: 'Searching the portfolio', detail: '4 documents', done: true, active: false },
    { label: 'Reading the sources', detail: '', done: false, active: true },
  ]);
  assert.deepEqual(record.plan, [
    { label: 'Find what the site says', detail: '', done: true },
    { label: 'Write the answer', detail: '', done: false },
  ]);
  assert.equal(record.current, 'Reading the sources', 'the progress line names the step in hand');
  // Once the turn has ended nothing is "in hand", even if a step never reported back.
  const finished = researchRecord({ ...working, streaming: false });
  assert.equal(finished.current, '');
  assert.equal(finished.steps.some(step => step.active), false);
  assert.equal(researchRecord({ reasoningSteps: [] }), null);
  assert.equal(researchRecord({}), null);
  assert.equal(researchRecord(null), null);

  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  // Nothing is parked between the question and a finished answer: no plan box, no research box.
  assert.ok(!/TodoList|ReasoningChain|cw-reasoning|todo-container/.test(widget));
  assert.ok(widget.includes('research={researchRecord(m)}'));
});

test('an attached file says what it is and how big it is', () => {
  assert.deepEqual(fileKind('notes.txt', 'text/plain'), { label: 'Text', icon: 'document' });
  assert.deepEqual(fileKind('scan.PDF', ''), { label: 'PDF', icon: 'document' });
  assert.deepEqual(fileKind('photo.bin', 'image/webp'), { label: 'Image', icon: 'image' });
  assert.deepEqual(fileKind('rows.csv', 'text/csv'), { label: 'CSV', icon: 'table' });
  assert.deepEqual(fileKind('README.md', 'text/markdown'), { label: 'Markdown', icon: 'document' });
  assert.deepEqual(fileKind('data.json', 'application/json'), { label: 'JSON', icon: 'document' });
  assert.deepEqual(fileKind('mystery', ''), { label: 'File', icon: 'document' });
  assert.deepEqual(fileKind(), { label: 'File', icon: 'document' });
  assert.equal(fileSize(0), '0 B');
  assert.equal(fileSize(960), '960 B');
  assert.equal(fileSize(3600), '4 KB');
  assert.equal(fileSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(fileSize(undefined), '');
  assert.equal(fileSize(-1), '');
  const chip = readFileSync(new URL('../src/components/chat/AttachmentChip.js', import.meta.url), 'utf8');
  // The upload flow and its browser tests tell the states apart by these names.
  assert.ok(chip.includes('uploading ? "cw-prog" : "cw-chip"'));
  assert.ok(chip.includes('aria-label="Remove file"'));
});

test('the smaller parts stay inside the widget and leave the launcher where the page puts it', () => {
  const css = readFileSync(new URL('../styles/chatWidgetParts.css', import.meta.url), 'utf8');
  const sheet = postcss.parse(css);
  const root = '#__chat_widget_root#__chat_widget_root';
  sheet.walkRules(rule => {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'keyframes') return;
    for (const selector of rule.selectors) assert.ok(selector.includes(root), selector);
    assert.doesNotMatch(rule.selector, /avatar|mr-pot/i);
    // The launcher is placed, dragged and hidden (while the terminal is open) by other code.
    if (rule.selectors.some(selector => /\.launch-button(:hover|:active)?$/.test(selector))) {
      rule.walkDecls(d => assert.ok(!/^(display|position|inset|top|left|right|bottom|margin.*|z-index)$/.test(d.prop), `${rule.selector} sets ${d.prop}`));
    }
  });
  assert.doesNotMatch(css, /url\(|@import/);
  let reduced = false;
  sheet.walkAtRules('media', rule => { if (rule.params.includes('prefers-reduced-motion')) reduced = true; });
  assert.ok(reduced);
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('styles/chatWidgetParts.css') > app.indexOf('styles/chatWidgetAnswer.css'));
  // The launcher keeps the name its tests and screen readers know it by; the extra line is for the eye.
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  assert.ok(widget.includes('alt="Chat Bot"') && widget.includes('<span className="cw-launch-name">Mr.Pot</span>'));
  assert.match(widget, /className="cw-launch-hint" aria-hidden="true"/);
});
