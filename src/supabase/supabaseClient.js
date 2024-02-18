import { createClient } from '@supabase/supabase-js';

// Ensure these variable names match with those in your .env file
// If these are used client-side, make sure they are prefixed with NEXT_PUBLIC_
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
