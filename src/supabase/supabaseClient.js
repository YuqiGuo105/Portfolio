import { createClient } from '@supabase/supabase-js';

// Ensure these variable names match with those in your .env file
// If these are used client-side, make sure they are prefixed with NEXT_PUBLIC_
const supabaseUrl = 'https://iyvhmpdfrnznxgyvvkvx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5dmhtcGRmcm56bnhneXZ2a3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDYwNjcyMjMsImV4cCI6MjAyMTY0MzIyM30.zwq9WBVBLmFaUnA2PBU9hanYfmJYMxfg4l37wXEf1NI';

export const supabase = createClient(supabaseUrl, supabaseKey);
