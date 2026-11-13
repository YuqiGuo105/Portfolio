import { createClient } from '@supabase/supabase-js';
import { createCatalogLoader } from './catalog.mjs';
import { memoryStore, redisStore } from './store.mjs';
import { createDiscoveryProvider } from './provider.mjs';
import { createDiscoveryService } from './service.mjs';
import { createModerator, memoryReviews, supabaseReviews } from './moderation.mjs';
import { rankedSearch } from '../rankedSearch.mjs';

export const discoveryEnabled = () => process.env.DISCOVERY_ENABLED === '1';
export const previewEnabled = () => process.env.NODE_ENV === 'development' && process.env.DISCOVERY_PREVIEW === '1';
const KEY = Symbol.for('portfolio.discovery.runtime.v1');
export function discoveryRuntime() {
  if (globalThis[KEY]) return globalThis[KEY];
  const preview = previewEnabled();
  const store = preview ? memoryStore() : redisStore(process.env.DISCOVERY_REDIS_URL || process.env.VALKEY_URL || process.env.REDIS_URL);
  const provider = createDiscoveryProvider();
  const reviews = preview ? memoryReviews() : supabaseReviews(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }));
  const loadCatalog = createCatalogLoader();
  const service = createDiscoveryService({ store, provider, loadCatalog, secondarySearch: async q => {
    const payload = await rankedSearch({ q, limit: 20 }, { fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(2500) }) });
    return payload.results.filter(item => ['Resume', 'Life'].includes(item.source));
  } });
  globalThis[KEY] = { store, provider, reviews, loadCatalog, service, preview,
    moderate: createModerator({ store, provider, reviews }) };
  return globalThis[KEY];
}
