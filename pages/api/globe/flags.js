import { createFlagsHandler, supabaseFlagStore } from '../../../src/lib/globeFlags.mjs';
import { isRateLimited } from '../../../src/lib/rateLimiter';
import { supabaseServer } from '../../../src/supabase/supabaseServer';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } };

export default createFlagsHandler({ store: () => supabaseFlagStore(supabaseServer), isRateLimited });
