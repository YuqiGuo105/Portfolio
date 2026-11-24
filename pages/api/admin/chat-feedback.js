import { requireAdmin } from '../../../src/lib/adminRouteAuth';
import { supabaseServer } from '../../../src/supabase/supabaseServer';
import { createFeedbackAdminHandler, supabaseFeedbackStore } from '../../../src/lib/chat/answerFeedback.mjs';

// Rated answers with their frozen runs (owner only). ?format=jsonl downloads the regression file.
export default createFeedbackAdminHandler({ authorize: requireAdmin, store: supabaseFeedbackStore(supabaseServer) });
