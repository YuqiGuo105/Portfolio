// A visitor's verdict on one answer, kept with a frozen copy of that answer's run.
//
// The browser sends the run ID and the verdict, nothing else. The run itself (question, answer,
// routing, safety checks, retrieval sources, models, prompt versions, tokens, timings) is read
// here, on the server, from the agent service that recorded it, so a visitor cannot store text
// of their own choosing, and can only rate a run their own chat session received.
//
// The copy is frozen at rating time: it stays as it was even if the agent service's history is
// trimmed later, which is what makes it usable for audits and as a regression set.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9_.:-]{8,80}$/;
const VERDICTS = new Set(['up', 'down']);
const ANSWER_LIMIT = 60_000, QUESTION_LIMIT = 8_000, RUN_LIMIT = 400_000, STEP_LIMIT = 300;
const missingTable = error => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))];
const steps = run => (Array.isArray(run?.steps) ? run.steps : []);

export const validRunId = value => typeof value === 'string' && UUID.test(value);
export const validSessionId = value => typeof value === 'string' && SESSION.test(value);
export const validVerdict = value => VERDICTS.has(value);

/** A page path without its query string: where the visitor was, never what they searched for. */
export function pagePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  return value.split(/[?#]/)[0].slice(0, 200) || null;
}

/** The stored row for one rated run. `run` is the record exactly as the agent service returned it. */
export function freezeRun(run, { verdict, page } = {}) {
  const all = steps(run);
  const kept = all.slice(0, STEP_LIMIT);
  let copy = { ...run, steps: kept, ...(all.length > kept.length ? { stepsTruncated: all.length } : {}) };
  // A run is a few kilobytes. If one is ever enormous, the question and answer still matter most.
  if (JSON.stringify(copy).length > RUN_LIMIT) copy = { ...run, steps: [], stepsTruncated: all.length };
  const details = all.map(step => step?.detail || {});
  const sources = details.flatMap(detail => (Array.isArray(detail.sources) ? detail.sources : []));
  const costs = details.map(detail => Number(detail.usage?.costUsd)).filter(value => Number.isFinite(value) && value >= 0);
  return {
    run_id: run.runId,
    verdict,
    session_id: run.sessionId,
    conversation_id: text(run.conversationId, 120) || null,
    question: text(run.question, QUESTION_LIMIT),
    answer: text(run.answer, ANSWER_LIMIT),
    route: text(run.route, 60) || null,
    status: text(run.status, 40) || null,
    latency_ms: Number.isInteger(run.latencyMs) && run.latencyMs >= 0 ? run.latencyMs : null,
    models: unique(details.map(detail => detail.model)).slice(0, 12),
    prompt_versions: unique(details.map(detail => detail.promptVersion)).slice(0, 12),
    source_count: new Set(sources.map(source => source?.chunkId || source?.url).filter(Boolean)).size,
    cost_usd: costs.length ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(6)) : null,
    page_path: pagePath(page),
    answered_at: run.completedAt || run.startedAt || null,
    run: copy,
  };
}

/** One line of the regression file: what was asked, what was answered, with what, and the verdict. */
export function exportLine(row) {
  const details = steps(row.run).map(step => ({ type: step?.type, ...(step?.detail || {}) }));
  const retrieval = details.find(detail => detail.type === 'retrieval.completed');
  return {
    runId: row.run_id,
    verdict: row.verdict,
    question: row.question,
    answer: row.answer,
    route: row.route,
    status: row.status,
    models: row.models || [],
    promptVersions: row.prompt_versions || [],
    retrieval: retrieval ? {
      query: retrieval.query ?? null, strategy: retrieval.retrievalStrategy ?? null, zeroHit: Boolean(retrieval.zeroHit),
      sources: (retrieval.sources || []).map(source => ({ title: source.title, url: source.url, sourceType: source.sourceType, documentId: source.documentId, chunkId: source.chunkId, score: source.score })),
    } : null,
    safety: details.filter(detail => detail.type === 'safety.check_completed')
      .map(detail => ({ check: detail.checkType, verdict: detail.verdict, category: detail.category, reason: detail.reason ?? null, promptVersion: detail.promptVersion })),
    usage: details.filter(detail => detail.usage).map(detail => ({ model: detail.model, ...detail.usage })),
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    page: row.page_path,
    answeredAt: row.answered_at,
    ratedAt: row.rated_at,
  };
}

/** Reads one run from the agent service's durable history, by exact ID, within the last `hours`. */
export function agentRunSource({ base, token, fetch: fetcher = fetch, timeoutMs = 8000 } = {}) {
  const root = String(base || '').replace(/\/+$/, '');
  return {
    configured: Boolean(root && token),
    async find(runId, hours = 48) {
      if (!root || !token) return null;
      const response = await fetcher(`${root}/api/admin/conversations?${new URLSearchParams({ q: runId, hours: String(hours), limit: '5' })}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Agent history answered ${response.status}`);
      return ((await response.json())?.items || []).find(item => item?.runId === runId) || null;
    },
  };
}

const LIST = 'run_id, verdict, question, answer, route, status, latency_ms, models, prompt_versions, source_count, cost_usd, page_path, answered_at, rated_at, updated_at';

export function supabaseFeedbackStore(client) {
  const table = () => client.from('chat_answer_feedback');
  const fail = error => { if (missingTable(error)) return null; throw new Error('Answer feedback unavailable'); };
  return {
    // null from any of these: the table does not exist yet (the migration has not been run).
    async save(row) {
      // Only the first rating freezes the run; changing the verdict must not rewrite that copy.
      const inserted = await table().upsert(row, { onConflict: 'run_id', ignoreDuplicates: true });
      if (inserted.error) return fail(inserted.error);
      const { error } = await table().update({ verdict: row.verdict, updated_at: new Date().toISOString() })
        .eq('run_id', row.run_id).eq('session_id', row.session_id);
      return error ? fail(error) : true;
    },
    async remove(runId, sessionId) {
      const { error } = await table().delete().eq('run_id', runId).eq('session_id', sessionId);
      return error ? fail(error) : true;
    },
    async list({ verdict, limit = 100, full = false } = {}) {
      let query = table().select(full ? `${LIST}, run` : LIST).order('updated_at', { ascending: false }).limit(limit);
      if (validVerdict(verdict)) query = query.eq('verdict', verdict);
      const { data, error } = await query;
      return error ? fail(error) : data || [];
    },
  };
}

export function memoryFeedbackStore() {
  const rows = new Map();
  return {
    rows,
    async save(row) {
      const now = new Date().toISOString();
      const existing = rows.get(row.run_id);
      rows.set(row.run_id, { rated_at: now, ...(existing || row), verdict: row.verdict, updated_at: now });
      return true;
    },
    async remove(runId, sessionId) { if (rows.get(runId)?.session_id === sessionId) rows.delete(runId); return true; },
    async list({ verdict, limit = 100, full = false } = {}) {
      return [...rows.values()].filter(row => !validVerdict(verdict) || row.verdict === verdict)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit)
        .map(row => (full ? row : Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'run' && key !== 'session_id' && key !== 'conversation_id'))));
    },
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * POST { runId, verdict: "up" | "down" | null, sessionId, page? } from the chat window.
 * 200 { saved }  the verdict is stored (or removed, for null)
 * 404            no such run, or it belongs to another session: the two are not told apart
 * 409            the run has no answer to rate
 */
export function createFeedbackHandler({ runs, store, limited = async () => false, ip = () => 'unknown', settleMs = 1200 }) {
  return async function feedbackHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    const { runId, verdict = null, sessionId, page } = req.body && typeof req.body === 'object' ? req.body : {};
    if (!validRunId(runId) || !validSessionId(sessionId) || (verdict !== null && !validVerdict(verdict))) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    if (await limited(ip(req))) return res.status(429).json({ error: 'rate_limited' });
    try {
      if (verdict === null) {
        const removed = await store.remove(runId, sessionId);
        return res.status(200).json({ saved: removed !== null, verdict: null });
      }
      if (!runs.configured) return res.status(200).json({ saved: false, verdict });
      // A rating almost always follows its answer, so the last two days are read first and the
      // full month only when the run is not there. The run's last record is written as its answer
      // finishes, so a rating made in the same second can arrive first: one short wait covers it.
      let run = await runs.find(runId, 48);
      if (!run) run = await runs.find(runId, 720);
      else if (!run.answer) { await wait(settleMs); run = await runs.find(runId, 48); }
      if (!run || run.sessionId !== sessionId) return res.status(404).json({ error: 'unknown_run' });
      if (!run.answer || !run.question) return res.status(409).json({ error: 'nothing_to_rate' });
      const saved = await store.save(freezeRun(run, { verdict, page }));
      return res.status(200).json({ saved: saved !== null, verdict });
    } catch (error) {
      console.error('[answer-feedback] not saved', error?.message || error);
      return res.status(503).json({ error: 'unavailable' });
    }
  };
}

/**
 * GET ?verdict=up|down&limit=  → { enabled, items }        rated answers, newest first
 * GET ?format=jsonl            → one exportLine per line     the regression file
 * GET ?full=1                  → items carry the frozen run
 */
export function createFeedbackAdminHandler({ authorize, store }) {
  return async function feedbackAdminHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
    const user = await authorize(req, res);
    if (!user) return undefined;
    const jsonl = req.query?.format === 'jsonl';
    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || (jsonl ? 1000 : 100), 1), jsonl ? 2000 : 200);
    try {
      const items = await store.list({ verdict: req.query?.verdict, limit, full: jsonl || req.query?.full === '1' });
      if (!jsonl) return res.status(200).json(items === null ? { enabled: false, items: [] } : { enabled: true, items });
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rated-answers${validVerdict(req.query?.verdict) ? `-${req.query.verdict}` : ''}.jsonl"`);
      return res.status(200).send((items || []).map(row => JSON.stringify(exportLine(row))).join('\n') + (items?.length ? '\n' : ''));
    } catch (error) {
      console.error('[answer-feedback] list failed', error?.message || error);
      return res.status(503).json({ error: 'unavailable', message: 'Rated answers could not be read just now.' });
    }
  };
}
