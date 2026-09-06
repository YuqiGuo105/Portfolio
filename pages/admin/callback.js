import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../src/supabase/supabaseClient';
import { verifyAdminSession } from '../../src/lib/writerApi';
import { completeGoogleLogin, googleAuthError, safeLoginRedirect } from '../../src/lib/googleAuth.mjs';

function sanitizeRedirect(target) {
  return safeLoginRedirect(target, '/admin');
}

function buildLoginRedirect(target, message) {
  const params = new URLSearchParams({
    redirect: sanitizeRedirect(target),
    reason: 'oauth_error',
  });
  if (message) params.set('message', message);
  return `/admin/login?${params.toString()}`;
}

export default function AdminOauthCallback() {
  const router = useRouter();
  const message = 'Completing Google sign-in...';

  useEffect(() => {
    if (!router.isReady) return undefined;
    let active = true;

    async function completeOauth() {
      const redirect = sanitizeRedirect(router.query.redirect);
      const code = typeof router.query.code === 'string' ? router.query.code : '';
      const authError = router.query.error || router.query.error_description;

      if (authError) {
        await router.replace(buildLoginRedirect(redirect, googleAuthError(router.query.error_code || router.query.error)));
        return;
      }

      if (!code) {
        await router.replace(buildLoginRedirect(redirect, 'Google sign-in returned without an authorization code.'));
        return;
      }

      try {
        await completeGoogleLogin(supabase, code);
        if (!active) return;

        const result = await verifyAdminSession();
        if (!active) return;
        if (result.authorized) {
          await router.replace(redirect);
          return;
        }

        if (result.status === 401 || result.status === 403) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          await router.replace(`/admin/login?redirect=${encodeURIComponent(redirect)}&reason=unauthorized`);
          return;
        }

        await router.replace(buildLoginRedirect(redirect,
          'The admin service is unavailable, so access could not be verified. Please try again.'));
      } catch (error) {
        if (!active) return;
        await router.replace(buildLoginRedirect(redirect,
          error?.message || 'Google sign-in could not be completed.'));
      }
    }

    completeOauth();
    return () => {
      active = false;
    };
  }, [router, router.isReady, router.query.code, router.query.error, router.query.error_description, router.query.redirect]);

  return (
    <div className="callback-page">
      <div className="callback-card">
        <h1>Admin Panel</h1>
        <p>{message}</p>
      </div>
      <style jsx>{`
        .callback-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: #0f172a;
        }
        .callback-card {
          width: min(100%, 420px);
          padding: 40px 32px;
          border-radius: 20px;
          background: #1e293b;
          color: #e2e8f0;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
          text-align: center;
        }
        h1 {
          margin: 0 0 12px;
          font-size: 1.5rem;
        }
        p {
          margin: 0;
          color: #94a3b8;
        }
      `}</style>
    </div>
  );
}
