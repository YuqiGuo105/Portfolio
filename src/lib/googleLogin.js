import { supabase } from '../supabase/supabaseClient';
import { startGoogleLogin } from './googleAuth.mjs';

export function signInWithGoogle({ redirect, admin = false } = {}) {
  return startGoogleLogin(supabase, {
    origin: window.location.origin,
    redirect: redirect || `${window.location.pathname}${window.location.search}${window.location.hash}`,
    admin,
  });
}
