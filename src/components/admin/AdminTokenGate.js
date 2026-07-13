// src/components/admin/AdminTokenGate.js
// Wraps any admin page. Requires both a Supabase session and an authorization
// probe against the admin service, which owns the email allow-list.
//
// This replaced the legacy `sessionStorage.admin_token` check — the admin
// panel now relies on the same Supabase session that the rest of the site
// uses, and the admin-service validates the JWT + email allow-list server-side.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../supabase/supabaseClient';
import { verifyAdminSession } from '../../lib/writerApi';

export default function AdminTokenGate({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let redirecting = false;

    const redirectToLogin = (reason) => {
      const target = router.asPath || '/admin';
      const reasonQuery = reason ? `&reason=${encodeURIComponent(reason)}` : '';
      router.replace(`/admin/login?redirect=${encodeURIComponent(target)}${reasonQuery}`);
    };

    async function checkAccess() {
      setReady(false);
      setCheckError('');
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (!data?.session) {
          redirectToLogin();
          return;
        }

        const result = await verifyAdminSession();
        if (!active) return;
        if (result.authorized) {
          setReady(true);
          return;
        }

        if (result.status === 401 || result.status === 403) {
          redirecting = true;
          await supabase.auth.signOut().catch(() => {});
          if (active) redirectToLogin('unauthorized');
          return;
        }

        setCheckError('Admin access could not be verified. Check the admin service and try again.');
      } catch {
        if (active) {
          setCheckError('Admin access could not be verified. Check your connection and try again.');
        }
      }
    }

    checkAccess();

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' && !redirecting) {
        setReady(false);
        redirectToLogin();
      }
    });

    return () => {
      active = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, [router, retryKey]);

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
  return children;
}
