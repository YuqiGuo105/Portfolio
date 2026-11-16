import { requireAdmin } from '../../../src/lib/adminRouteAuth';
import { supabaseServer } from '../../../src/supabase/supabaseServer';
import { createDismissalHandler, supabaseDismissalStore } from '../../../src/lib/adminDismissals.mjs';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

// Notifications cleared from the bell in the admin top bar (owner only).
export default createDismissalHandler({ authorize: requireAdmin, store: supabaseDismissalStore(supabaseServer) });
