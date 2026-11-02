import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// A build without the public Supabase settings (a Vercel Preview environment that does not have them,
// or a fresh clone) must still build: createClient throws on a missing URL or key, and every page that
// imports this module failed "Collecting page data" with it. Such a build gets a client pointed at a
// reserved host that never resolves, so its queries fail like any network error and the pages show their
// empty states. Production and local setups with .env.local are unaffected.
const UNCONFIGURED_URL = 'https://supabase-not-configured.invalid';
const configured = Boolean(supabaseUrl && supabaseAnonKey);
if (!configured && typeof window !== 'undefined') {
	console.warn('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
}

export const supabaseConfigured = configured;

export const supabase = createClient(configured ? supabaseUrl : UNCONFIGURED_URL, configured ? supabaseAnonKey : 'unconfigured', {
	auth: {
		flowType: 'pkce',
		// Callback pages own PKCE exchange; avoid consuming the code twice.
		detectSessionInUrl: typeof window === 'undefined'
			|| !/^\/(?:auth|admin)\/callback\/?$/.test(window.location.pathname),
		persistSession: true,
		autoRefreshToken: true,
	},
});
