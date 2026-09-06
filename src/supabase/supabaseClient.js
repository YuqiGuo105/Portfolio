import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		flowType: 'pkce',
		// Callback pages own PKCE exchange; avoid consuming the code twice.
		detectSessionInUrl: typeof window === 'undefined'
			|| !/^\/(?:auth|admin)\/callback\/?$/.test(window.location.pathname),
		persistSession: true,
		autoRefreshToken: true,
	},
});
