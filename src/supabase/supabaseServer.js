// Server-only Supabase client (uses the service_role key). Never import
// this from a client component or a browser bundle.
//
// The client is created LAZILY on first use rather than at module load
// time. Reason: Next.js `next build` runs a "Collecting page data" pass
// that imports every page module. If SUPABASE_SERVICE_ROLE_KEY is not
// present in that environment (typical in CI where the key is only
// injected at runtime), an eager `createClient()` throws and the whole
// build fails — even though `getServerSideProps` never actually runs
// during build.
//
// We expose a Proxy that quacks like the underlying client: property
// access such as `supabaseServer.from(...)` triggers instantiation on
// demand, so the module can be imported safely with no env vars and
// only errors if a real query is attempted without them.
import { createClient } from '@supabase/supabase-js';

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // must NOT have NEXT_PUBLIC_ prefix
  if (!url || !key) {
    throw new Error(
      'supabaseServer: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var'
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export const supabaseServer = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const value = client[prop];
      // Bind methods so `this` stays the underlying SupabaseClient.
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);
