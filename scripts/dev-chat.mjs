// Local preview of the chat widget with a stand-in assistant. No model, no database, no network:
// every answer below is canned and arrives over the same event stream the real assistant uses.
//
//   npm run dev:chat            → http://127.0.0.1:3168/?openChat=1
//   CHAT_PREVIEW_PACE=0 npm run dev:chat      answers arrive at once (for scripted checks)
//
//   CHAT_PREVIEW_LINE=queued npm run dev:chat   the waiting-line notice (also: full)
//
// Things to type: "介绍一下 Yuqi 和他的社交账号" (links), "How is the platform built?" (headings, table, code),
// "Show me his projects" (links to pages), "带我逛一下" (the guide as a message), "Use a tool",
// "Show it on the page" (page controls), "Slow test", "Error test". Deep mode shows the research steps.
// Voice input records for real; the transcript is canned. Attached files go nowhere.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('Local preview only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3168);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const pace = Number(process.env.CHAT_PREVIEW_PACE ?? 1);
process.env.NODE_ENV = 'development';
process.env.NEXT_PUBLIC_VOICE_ENABLED = 'true';

const site = 'https://www.yuqi.site';
const SOURCES = [
  { title: 'Portfolio Platform', url: `${site}/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c`, snippet: 'One transaction writes the article, its version and an outbox event. A leased relay publishes to Kafka; failures retry with backoff and then move to a dead-letter queue.' },
  { title: 'Subscription & Notification Platform', url: `${site}/work-single/c049c604-50bd-4265-9318-866fd5f1a69e`, snippet: 'A later resubscribe creates a new verification challenge rather than silently reactivating the address.' },
  { title: 'Open Source Reliability Engineering', url: `${site}/work-single/0470298d-c74d-4d4b-be33-d948b033002a`, snippet: 'Merged upstream contributions improving workflow recovery, bounded AI-provider retries, and Kubernetes Java client correctness.' },
  { title: 'GitHub Operations in Practice: Pull Requests, CI/CD, Releases, and Recovery', url: `${site}/blog-single/df9bed8e-163b-41bb-82be-7f970eb7875d`, sourceRequiresLogin: true },
];
const GUIDE = {
  language: 'zh', startMode: 'OFFER', responseMessage: '我已经为你准备好网页导览，并标出了相关区域。',
  controls: { start: '开始网页导览' },
  steps: [
    { targetKey: 'home.about', title: '关于 Yuqi', content: '后端与 AI 系统方向的软件工程师。' },
    { targetKey: 'home.projects', title: '项目', content: '平台、通知与开源贡献。' },
    { targetKey: 'home.contact', title: '联系', content: '留言、内推与实时聊天。' },
  ],
};

const ANSWERS = [
  { when: /社交|social|账号|介绍|introduce|who is/i, sources: SOURCES, guide: GUIDE, text: `您好！我是 Yuqi 的 AI 助手。

Yuqi 是一位软件工程师，专注于后端和 AI 系统。他目前在高盛（Goldman Sachs）担任软件工程师，专注于微服务和分布式系统。

以下是 Yuqi 的社交账号链接：

- **GitHub:** https://github.com/YuqiGuo105
- **LeetCode:** https://leetcode.com/u/SY0JvhmwHK/
- **Instagram:** https://www.instagram.com/yuqi_guo17/
- **LinkedIn:** https://www.linkedin.com/in/y-guo-6080733a5/` },
  { when: /project|项目|work/i, sources: SOURCES.slice(0, 3), text: `Three projects cover most of what Yuqi builds:

- [Portfolio Platform](${site}/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c) — publishing, search and AI retrieval behind this site
- [Subscription & Notification Platform](${site}/work-single/c049c604-50bd-4265-9318-866fd5f1a69e) — verified email subscriptions and delivery
- [Open Source Reliability Engineering](${site}/work-single/0470298d-c74d-4d4b-be33-d948b033002a) — merged fixes in Kubernetes, RxJava and Google ADK

The [architecture page](${site}/architecture) shows how they connect, and you can write to [hello@example.com](mailto:hello@example.com).` },
  { when: /guide|tour|导览|逛|参观/i, guide: { ...GUIDE, responseMessage: '好的，我准备了一条三站的网页导览：关于、项目和联系方式。' }, text: '好的，我准备了一条三站的网页导览：关于、项目和联系方式。' },
  { when: /on the page|页面上/i, browser: { schemaVersion: 1, autoStart: false, actions: [
    { type: 'diagram_step', flow: 'publish-content', step: 3 }, { type: 'terminal_command', command: 'ls projects' }] },
    text: 'I can point at it on the page: the third step of the publishing diagram, then the project list in the terminal.' },
  { when: /tool/i, tool: true, text: 'I looked that up with the portfolio search tool: the newest article is **GitHub Operations in Practice**, published this month.' },
  { when: /platform|architecture|built|架构|kafka/i, sources: SOURCES.slice(0, 2), text: `## How publishing works

Publishing an article is **one database transaction**. It writes the article, a new row in \`content_versions\`, and an outbox event, so a reader never sees one without the others.

1. A leased relay claims ready outbox rows and publishes them to Kafka.
2. Followers update search, the AI index and subscriber notifications on their own.
3. A failed delivery retries with backoff, then moves to a dead-letter queue.

### Where the time goes

| Stage | Typical | Notes |
| --- | --- | --- |
| Outbox relay | 120 ms | leased, at-least-once |
| Search indexing | 0.4 s | BM25, no model call at query time |
| AI indexing | 1.8 s | embeddings per chunk |

> Followers are idempotent: the key is \`jobType:sourceType:sourceId:vN\`.

\`\`\`java
@Transactional
public Version publish(UUID contentId) {
  Version version = versions.append(contentId);
  outbox.add(ContentPublishedEvent.of(contentId, version.number()));
  return version;
}
\`\`\`

More detail is on the [architecture page](${site}/architecture).` },
  { when: /./, text: 'This is the local preview. Ask about **projects**, the **platform**, or Yuqi’s **social links** to see each kind of answer.' },
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms * pace));
async function answer(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || '{}');
  const question = String(input.question || '');
  const deep = input.mode === 'DEEPTHINKING';
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  const send = (stage, extra = {}) => res.write(`data: ${JSON.stringify({ stage, ...extra })}\n\n`);
  const step = async (stage, message, ms, usage) => {
    send(stage, { status: 'started', message });
    await wait(ms);
    send(stage, { status: 'completed', message, durationMs: ms, ...(usage ? { payload: { usage } } : {}) });
  };
  let open = true;
  res.on('close', () => { open = false; });

  send('run_metadata', { payload: { runId: '3f44067a-278f-4ce3-8780-2a00379dda15' } });
  await step('safety_check', 'Checking the request…', 620);
  if (/error|fail/i.test(question)) { send('error', { payload: { code: 'AI_SERVICE_UNAVAILABLE' } }); return res.end(); }
  await step('routing', 'Understanding the question…', 540);
  if (/slow/i.test(question)) await wait(12000);
  if (!open) return;
  const reply = ANSWERS.find(item => item.when.test(question));
  if (reply.tool) {
    send('tool_call_start', { payload: { toolName: 'search_content', callId: 'local-1', args: 'newest article' } });
    await wait(700);
    send('tool_call_result', { payload: { toolName: 'search_content', callId: 'local-1', latencyMs: 412, status: 'done' } });
  }
  if (deep) {
    send('deep_plan_done', { payload: { status: 'planned', subtaskCount: 3, subtasks: [
      { text: 'Find what the site says about the question', status: 'complete' },
      { text: 'Check each claim against a second source', status: 'complete' },
      { text: 'Write the answer with its sources', status: 'pending' }] } });
    for (const [label, detail] of [['Searching the portfolio', '4 documents'], ['Reading the sources', 'Portfolio Platform, 2 more'], ['Checking the claims', 'All supported']]) {
      send('reasoning_step', { payload: { label, completed: false } });
      await wait(900);
      send('reasoning_step', { payload: { label, detail, completed: true } });
    }
    send('key_concepts', { payload: { concepts: [{ term: 'outbox', importance: 'primary' }, { term: 'Kafka', type: 'TECH' }, { term: 'idempotency', importance: 'contextual' }] } });
  }
  await step('knowledge_retrieval', 'Searching the portfolio…', 380);
  if (reply.sources) send('sources_found', { payload: { sources: reply.sources } });
  await step('generation', 'Preparing a grounded answer…', 1360, { inputTokens: 4675, outputTokens: 169, costUsd: 0.000535 });
  if (reply.guide) send('tour_steps', { payload: reply.guide });
  if (reply.browser) send('browser_actions', { status: 'completed', payload: reply.browser });
  await step('output_safety', 'Checking the answer…', 480);
  if (!open) return;
  send('answer_final', { payload: { answer: reply.text } });
  send('done');
  res.end();
}

const TRANSCRIPTS = ['How is the publishing pipeline built?', '请介绍一下 Yuqi 的项目。'];
let spoken = 0;

const app = require('next')({ dev: true, dir: root, hostname: '127.0.0.1', port, conf: { ...require('../next.config.js'), distDir: '.next-chat' } });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end('Local preview only'); return; }
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/health') return json({ status: 'UP' });
  if (!url.pathname.startsWith('/api/')) return handle(req, res);
  if (url.pathname === '/api/rag/capabilities') return json({ deep: true, attachments: true });
  if (url.pathname === '/api/rag/admission') {
    const line = process.env.CHAT_PREVIEW_LINE;
    return json(line === 'queued' ? { status: 'queued', ahead: 3, eta: 240 } : line === 'full' ? { status: 'full', reason: 'daily' } : { status: 'active', messages: 15, seconds: 600 });
  }
  if (url.pathname.endsWith('/attachments/upload-url')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let mimeType = 'application/octet-stream';
    try { mimeType = String(JSON.parse(body).mimeType || mimeType); } catch { /* keep the default */ }
    return json({ attachmentId: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, mimeType, uploadUrl: '/api/rag/local-upload' });
  }
  if (url.pathname === '/api/rag/local-upload') { for await (const chunk of req) void chunk; await wait(900); return json({ status: 'READY' }); }
  if (url.pathname.includes('/attachments/')) { req.resume(); res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/intent/route') return json({ routeKind: 'GENERAL_CHAT' });
  if (url.pathname === '/api/agent/intent') return json({ handled: false });
  if (url.pathname === '/api/track') return json({ accepted: true });
  if (url.pathname === '/api/rag/transcribe') {
    req.resume();
    await wait(1400);
    return json({ text: TRANSCRIPTS[spoken++ % TRANSCRIPTS.length] });
  }
  if (url.pathname.endsWith('/answer/stream')) return answer(req, res).catch(() => res.end());
  return json({ error: 'Switched off in the local preview' }, 503);
});
server.listen(port, '127.0.0.1', () => console.log(`Chat preview ready:  http://127.0.0.1:${port}/?openChat=1`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); app.close().then(() => process.exit(0)); });
