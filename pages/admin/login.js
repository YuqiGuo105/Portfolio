// pages/admin/login.js
// Admin login page — uses Supabase signInWithPassword to mint a JWT.
// On success the Supabase session is stored by @supabase/supabase-js and
// the admin pages read it via AdminTokenGate / writerApi.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../src/supabase/supabaseClient';
import { verifyAdminSession } from '../../src/lib/writerApi';

function sanitizeRedirect(target) {
  if (typeof target !== 'string') return '/admin';
  // Only accept internal paths so we don't open an open-redirect.
  if (!target.startsWith('/') || target.startsWith('//')) return '/admin';
  return target;
}

function buildOauthRedirect(target) {
  if (typeof window === 'undefined') return undefined;
  const safe = sanitizeRedirect(target);
  return `${window.location.origin}/admin/callback?redirect=${encodeURIComponent(safe)}`;
}

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function routeAuthorizedSession() {
    const result = await verifyAdminSession();
    if (result.authorized) {
      await router.replace(sanitizeRedirect(router.query.redirect));
      return true;
    }

    if (result.status === 401 || result.status === 403) {
      await supabase.auth.signOut().catch(() => {});
      setError('This account is not authorized to access the admin panel.');
      return false;
    }

    setError('The admin service is unavailable, so access could not be verified. Please try again.');
    return false;
  }

  // Existing OAuth/password sessions must still pass the backend allow-list.
  useEffect(() => {
    if (!router.isReady) return undefined;
    let active = true;

    async function checkExistingSession() {
      setCheckingSession(true);
      if (router.query.reason === 'unauthorized') {
        setError('This account is not authorized to access the admin panel.');
      } else if (router.query.reason === 'oauth_error') {
        setError(typeof router.query.message === 'string'
          ? router.query.message
          : 'Google sign-in could not be completed. Please try again.');
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || !data?.session) return;
        await routeAuthorizedSession();
      } catch {
        if (active) setError('Could not verify your session. Please try again.');
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    checkExistingSession();
    return () => {
      active = false;
    };
  }, [router.isReady, router.query.redirect, router.query.reason]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message || 'Invalid email or password');
        return;
      }
      await routeAuthorizedSession();
    } catch (err) {
      setError(err?.message || 'Could not reach Supabase. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setGoogleLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: buildOauthRedirect(router.query.redirect),
        },
      });
      if (oauthError) {
        setError(oauthError.message || 'Could not start Google sign-in.');
      }
      // On success Supabase navigates away; the bounce-back lands in the
      // useEffect above which detects the session and routes to /admin.
    } catch (err) {
      setError(err?.message || 'Could not start Google sign-in.');
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Admin Panel</h1>
        <p className="login-subtitle">
          Sign in with your Supabase account. Only emails in the admin allow-list
          can access content management.
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Supabase password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="login-button" disabled={checkingSession || loading || googleLoading}>
            {checkingSession ? 'Checking session…' : loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="divider"><span>or</span></div>

        <button
          type="button"
          className="google-button"
          onClick={handleGoogleSignIn}
          disabled={checkingSession || loading || googleLoading}
        >
          <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.4 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C42 35.3 44 30 44 24c0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <p className="login-footer">
          Need an account? Sign-up is disabled for the admin panel — please
          contact the site owner.
        </p>
      </div>

      <style jsx>{`
        .login-page {
          min-height: 100vh;
          background: #0f172a;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .login-card {
          background: #1e293b;
          border-radius: 20px;
          padding: 48px 40px;
          width: min(100%, 420px);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
        }
        .login-title {
          font-size: 1.6rem;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0 0 8px;
        }
        .login-subtitle {
          color: #94a3b8;
          font-size: 0.9rem;
          margin: 0 0 32px;
          line-height: 1.5;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .field input {
          padding: 12px 16px;
          background: #0f172a;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 150ms;
        }
        .field input:focus { border-color: #38bdf8; }
        .error-text {
          color: #f87171;
          font-size: 0.85rem;
          margin: 0;
        }
        .login-button {
          padding: 13px;
          background: #38bdf8;
          border: none;
          border-radius: 10px;
          color: #0f172a;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: background 150ms;
        }
        .login-button:hover:not(:disabled) { background: #0ea5e9; }
        .login-button:disabled { opacity: 0.6; cursor: not-allowed; }
        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 24px 0 0;
          color: #475569;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(148, 163, 184, 0.2);
        }
        .google-button {
          margin-top: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 12px;
          background: #f8fafc;
          border: 1px solid rgba(148, 163, 184, 0.4);
          border-radius: 10px;
          color: #0f172a;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: background 150ms, border-color 150ms;
        }
        .google-button:hover:not(:disabled) {
          background: #ffffff;
          border-color: #38bdf8;
        }
        .google-button:disabled { opacity: 0.6; cursor: not-allowed; }
        .google-icon { width: 18px; height: 18px; }
        .login-footer {
          margin: 32px 0 0;
          color: #64748b;
          font-size: 0.8rem;
          text-align: center;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
