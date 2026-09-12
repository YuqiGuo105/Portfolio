import { supabase } from '../supabase/supabaseClient';
import { createAnalyticsIdentity } from './analyticsIdentity.mjs';

let identity;

export function getAnalyticsIdentity() {
  if (!identity) {
    identity = createAnalyticsIdentity({
      getSession: () => supabase.auth.getSession(),
      verify: async (token, signal) => {
        const response = await fetch('/api/analytics/participation', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store', signal,
        });
        if (!response.ok) throw new Error('Analytics identity unavailable');
        return response.json();
      },
    });
    // Synchronous callback: never await Supabase while its auth lock is held.
    supabase.auth.onAuthStateChange(event => {
      if (event !== 'INITIAL_SESSION') identity.invalidate();
    });
  }
  return identity.resolve();
}
