// src/components/admin/AdminTokenGate.js
// Wraps any admin page. Requires both a Supabase session and an authorization
// probe against the admin service, which owns the admin registry and RBAC.
//
// This replaced the legacy `sessionStorage.admin_token` check — the admin
// panel now relies on the same Supabase session that the rest of the site
// uses. The admin-service validates the JWT, account status, role, and owner
// capability server-side before protected content is rendered.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../supabase/supabaseClient';
import { verifyAdminSession } from '../../lib/writerApi';
import { AdminSessionProvider } from './AdminSessionContext';

const ACCESS_CHECK_TIMEOUT_MS = 10_000;
const ACCESS_RECHECK_MS = 60_000;
const FOCUS_RECHECK_THROTTLE_MS = 15_000;

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error('Admin access check timed out.');
      error.code = 'admin_access_timeout';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

export default function AdminTokenGate({ children, requiredPermission = 'admin.read' }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let active = true;
    let redirecting = false;
    let authorized = false;
    let inFlightCheck = null;
    let lastCheckedAt = 0;

    const loginUrl = (reason) => {
      const target = router.asPath || '/admin';
      const reasonQuery = reason ? `&reason=${encodeURIComponent(reason)}` : '';
      return `/admin/login?redirect=${encodeURIComponent(target)}${reasonQuery}`;
    };

    const redirectToLogin = (reason) => {
      if (redirecting) return;
      redirecting = true;
      authorized = false;
      setReady(false);
      setProfile(null);
      void router.replace(loginUrl(reason));
    };

    const expireSession = async (reason) => {
      if (redirecting) return;
      redirecting = true;
      authorized = false;
      setReady(false);
      setProfile(null);
      await supabase.auth.signOut().catch(() => {});
      if (active) {
        void router.replace(loginUrl(reason));
      }
    };

    function checkAccess({ initial = false } = {}) {
      if (redirecting) return Promise.resolve();
      if (inFlightCheck) return inFlightCheck;

      inFlightCheck = (async () => {
        if (initial) {
          setReady(false);
          setProfile(null);
          setCheckError('');
        }

        try {
          const sessionResult = await withTimeout(
            supabase.auth.getSession(),
            ACCESS_CHECK_TIMEOUT_MS,
          );
          if (!active) return;

          let session = sessionResult?.data?.session;
          if (!session) {
            redirectToLogin();
            return;
          }

          const expiresAtMs = Number(session.expires_at || 0) * 1000;
          if (expiresAtMs > 0 && expiresAtMs <= Date.now()) {
            const refreshResult = await withTimeout(
              supabase.auth.refreshSession(),
              ACCESS_CHECK_TIMEOUT_MS,
            );
            session = refreshResult?.data?.session;
            if (refreshResult?.error || !session) {
              await expireSession('session_expired');
              return;
            }
          }

          const result = await withTimeout(
            verifyAdminSession(),
            ACCESS_CHECK_TIMEOUT_MS,
          );
          if (!active) return;
          if (result.authorized) {
            if (!result.profile?.permissions?.includes(requiredPermission)) {
              authorized = false;
              setProfile(null);
              setReady(false);
              setCheckError('Your admin role does not permit access to this page.');
              return;
            }
            authorized = true;
            setProfile(result.profile);
            setCheckError('');
            setReady(true);
            return;
          }

          if (result.status === 401) {
            await expireSession('session_expired');
            return;
          }
          if (result.status === 403) {
            await expireSession('unauthorized');
            return;
          }

          if (!authorized) {
            setCheckError('Admin access could not be verified. Check the admin service and try again.');
          }
        } catch {
          if (active && !authorized) {
            setCheckError('Admin access could not be verified. Check your connection and try again.');
          }
        } finally {
          lastCheckedAt = Date.now();
          inFlightCheck = null;
        }
      })();

      return inFlightCheck;
    }

    void checkAccess({ initial: true });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' || !session) {
        redirectToLogin(event === 'SIGNED_OUT' ? 'session_expired' : undefined);
        return;
      }
      if (event === 'TOKEN_REFRESHED') {
        window.setTimeout(() => {
          if (active) void checkAccess();
        }, 0);
      }
    });

    const intervalId = window.setInterval(() => {
      void checkAccess();
    }, ACCESS_RECHECK_MS);

    const recheckAfterResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheckedAt < FOCUS_RECHECK_THROTTLE_MS) return;
      void checkAccess();
    };
    window.addEventListener('focus', recheckAfterResume);
    document.addEventListener('visibilitychange', recheckAfterResume);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', recheckAfterResume);
      document.removeEventListener('visibilitychange', recheckAfterResume);
      authListener?.subscription?.unsubscribe?.();
    };
  }, [requiredPermission, router, retryKey]);

  if (checkError) {
    return (
      <div className="admin-gate-error">
        <p>{checkError}</p>
        <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
          Try again
        </button>
        <style jsx>{`
          .admin-gate-error {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 24px;
            background: #0f172a;
            color: #e2e8f0;
            text-align: center;
          }
          .admin-gate-error p { margin: 0; }
          .admin-gate-error button {
            padding: 10px 18px;
            border: 0;
            border-radius: 6px;
            background: #38bdf8;
            color: #0f172a;
            font-weight: 700;
            cursor: pointer;
          }
        `}</style>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="admin-gate-loading" role="status" aria-live="polite">
        <span className="admin-gate-spinner" aria-hidden="true" />
        <strong>Checking admin access</strong>
        <span>Verifying your session and permissions.</span>
        <style jsx>{`
          .admin-gate-loading {
            min-height: 100vh;
            display: grid;
            place-content: center;
            justify-items: center;
            gap: 9px;
            padding: 24px;
            background: #f5f7f8;
            color: #66717d;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
          }
          .admin-gate-loading strong { color: #17212b; font-size: 14px; }
          .admin-gate-spinner {
            width: 24px;
            height: 24px;
            margin-bottom: 4px;
            border: 2px solid #d5dcdf;
            border-top-color: #0f766e;
            border-radius: 50%;
            animation: adminGateSpin 700ms linear infinite;
          }
          @keyframes adminGateSpin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }
  return <AdminSessionProvider value={profile}>{children}</AdminSessionProvider>;
}
