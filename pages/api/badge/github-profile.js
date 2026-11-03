// GET /api/badge/github-profile — the view counter on the GitHub profile README.
//
// Each fetch by GitHub's image proxy is one profile view: it goes to Kafka as a `github_profile_view` event
// (Supabase visitor_logs when Kafka is down, as in /api/track) and the response is an SVG badge with the
// total so far. src/lib/githubProfileBadge.mjs has the rules; this file wires in Kafka, Supabase and Valkey.
import {
  BADGE_RATE_LIMIT,
  GITHUB_PROFILE_VIEW_EVENT,
  SITE_ID,
  createGithubBadgeHandler,
  sumEventCounts,
} from '../../../src/lib/githubProfileBadge.mjs';
import { produceRawEvent } from '../../../src/lib/kafkaProducer';
import { isRateLimited } from '../../../src/lib/rateLimiter';
import { isLocalAnalyticsRequest } from '../../../src/lib/analyticsHostFilter';
import { supabaseServer } from '../../../src/supabase/supabaseServer';
import { uuidv7 } from '../../../src/lib/uuidv7';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const supabaseConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// The all-time total from the aggregator's daily GLOBAL rollups, which are kept forever. A view without a
// location adds one row a day, so a single page covers years.
async function loadCount() {
  if (!supabaseConfigured()) return null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseServer
      .from('geo_time_rollups')
      .select('event_count')
      .eq('site_id', SITE_ID)
      .eq('granularity', '1d')
      .eq('geo_level', 'GLOBAL')
      .eq('event_type', GITHUB_PROFILE_VIEW_EVENT)
      .order('bucket_time', { ascending: true })
      .order('device_type', { ascending: true })
      .order('browser', { ascending: true })
      .order('os', { ascending: true })
      .order('is_bot', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    total += sumEventCounts(data);
    if (!data || data.length < PAGE_SIZE) return total;
  }
  return total;
}

async function fallbackInsert(row) {
  if (!supabaseConfigured()) return { ok: false };
  const { error } = await supabaseServer.from('visitor_logs').insert([row]);
  return { ok: !error };
}

const handle = createGithubBadgeHandler({
  produce: produceRawEvent,
  fallbackInsert,
  loadCount,
  rateLimited: (ip) => isRateLimited(ip, 'github-badge', BADGE_RATE_LIMIT),
  newEventId: uuidv7,
  isLocal: isLocalAnalyticsRequest,
});

export default async function handler(req, res) {
  const result = await handle(req);
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  if (result.via !== 'not_counted' && result.via !== 'method_not_allowed') {
    console.log(`[GithubBadge] view via=${result.via}`);
  }
  return res.status(result.status).send(result.body);
}
