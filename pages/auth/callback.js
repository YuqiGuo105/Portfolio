import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../src/supabase/supabaseClient';
import { completeGoogleLogin, googleAuthError, safeLoginRedirect } from '../../src/lib/googleAuth.mjs';
import { signInWithGoogle } from '../../src/lib/googleLogin';

export default function GoogleCallback() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const target = safeLoginRedirect(router.query.redirect);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let active = true;
    async function complete() {
      if (router.query.error || router.query.error_description) {
        throw new Error(googleAuthError(router.query.error_code || router.query.error));
      }
      await completeGoogleLogin(supabase, router.query.code);
      if (active) await router.replace(target);
    }
    complete().catch((cause) => {
      if (active) setError(cause.message || googleAuthError());
    });
    return () => { active = false; };
  }, [router.isReady, router.query.code, router.query.error, router.query.error_code, router.query.error_description, target, router]);

  return (
    <main className="auth-callback">
      <Head><title>Sign in | Yuqi Guo</title><meta name="robots" content="noindex, nofollow" /><meta name="referrer" content="no-referrer" /></Head>
      <section aria-live="polite">
        <h1>{error ? 'Unable to sign in' : 'Completing sign-in'}</h1>
        {error ? <p role="alert">{error}</p> : <p>Verifying your existing account...</p>}
        {error && <nav>
          <button disabled={retrying} onClick={async () => {
            setRetrying(true);
            try { await signInWithGoogle({ redirect: target }); }
            catch (cause) { setError(cause.message); }
            finally { setRetrying(false); }
          }}>{retrying ? 'Connecting...' : 'Try Google again'}</button>
          <a href={target}>Return to page</a>
        </nav>}
      </section>
      <style jsx>{`
        .auth-callback { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f7f7; color: #192d30; }
        section { width: 100%; max-width: 440px; }
        h1 { font-size: 24px; line-height: 1.3; letter-spacing: 0; }
        p { font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; }
        nav { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-top: 24px; }
        button { padding: 12px 18px; min-height: 44px; background: #087d75; color: white; border: 0; border-radius: 6px; cursor: pointer; }
        button:disabled { opacity: .6; cursor: wait; }
        a { color: #087d75; text-decoration: underline; }
      `}</style>
    </main>
  );
}
