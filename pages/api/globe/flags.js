import { createFlagsHandler, supabaseFlagStore } from '../../../src/lib/globeFlags.mjs';
import { isRateLimited } from '../../../src/lib/rateLimiter';
import { supabaseServer } from '../../../src/supabase/supabaseServer';
import { discoveryEnabled, discoveryRuntime } from '../../../src/lib/discovery/runtime.mjs';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } };

export default createFlagsHandler({ store: () => supabaseFlagStore(supabaseServer), isRateLimited,
  moderate: async (channel, text) => {
    if (!discoveryEnabled()) return { decision: 'review' };
    try { return await discoveryRuntime().moderate(channel, text); } catch { return { decision: 'review' }; }
  },
});
