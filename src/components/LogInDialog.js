// src/components/LogInDialog.js
'use client';

import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { supabase } from '../supabase/supabaseClient';

export default function LogInDialog({
                                      open,
                                      title = 'Log In Required',
                                      onClose,
                                      onConfirm,
                                      onRegister,
                                      registerHref = '/register',
                                      children,
                                    }) {
  const ref = useRef(null);
  const [authError, setAuthError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  // sync open -> <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setAuthError('');
      setGoogleLoading(false);
    }
  }, [open]);

  // ESC / native close → onClose
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onClose && onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  const onBackdropClick = (e) => {
    if (e.target === ref.current) onClose && onClose();
  };

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    setAuthError('');
    setGoogleLoading(true);
    try {
      const redirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: redirectTo ? { redirectTo } : undefined,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google login failed', error);
      setAuthError(error.message || 'Unable to continue with Google. Please try again.');
      setGoogleLoading(false);
    }
  };

  const handleLogin = () => {
    if (onConfirm) onConfirm();
    if (onClose) onClose();
  };

  const handleRegister = () => {
    if (onRegister) {
      onRegister();
    } else if (registerHref && typeof window !== 'undefined') {
      window.location.href = registerHref;
    }
    if (onClose) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      className="w-[min(92vw,440px)] p-0 rounded-3xl backdrop:bg-black/60"
    >
      <div className="relative overflow-hidden rounded-3xl bg-white">
        <div className="absolute inset-x-8 top-0 h-24 translate-y-[-50%] rounded-full bg-gradient-to-br from-indigo-200 via-sky-200 to-transparent blur-2xl opacity-70" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-500">Account</p>
              <h2 className="text-2xl font-semibold text-gray-900 sm:text-[26px]">{title}</h2>
              <p className="text-sm text-gray-600">
                {children ?? 'Please log in to continue.'}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-semibold text-gray-500 shadow-sm transition hover:text-gray-700"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleLogin}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/60"
            >
              Go to Login
            </button>

            <button
              type="button"
              onClick={handleGoogleLogin}
              className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={googleLoading}
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                viewBox="0 0 24 24"
              >
                <path
                  fill="#4285F4"
                  d="M23.52 12.272c0-.851-.076-1.67-.217-2.454H12v4.64h6.476a5.54 5.54 0 0 1-2.404 3.64v3.02h3.884c2.274-2.095 3.564-5.18 3.564-8.846Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.956-1.073 7.941-2.908l-3.884-3.02c-1.077.72-2.457 1.147-4.057 1.147-3.122 0-5.768-2.108-6.709-4.946H1.29v3.11A11.998 11.998 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.291 14.273A7.198 7.198 0 0 1 4.911 12c0-.79.136-1.556.38-2.273V6.616H1.29A11.998 11.998 0 0 0 0 12c0 1.942.463 3.775 1.29 5.384l4.001-3.111Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.763 0 3.342.607 4.586 1.797l3.44-3.44C17.952 1.23 15.236 0 12 0 7.29 0 3.152 2.69 1.29 6.616l4.001 3.11C6.232 6.858 8.878 4.75 12 4.75Z"
                />
              </svg>
              {googleLoading ? 'Connecting…' : 'Continue with Google'}
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.3em] text-gray-400">
              <span className="h-px flex-1 bg-gray-200" />
              <span>or</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="rounded-2xl bg-gray-50 px-4 py-4 text-center text-sm text-gray-600">
              <p className="mb-2 font-medium text-gray-700">New here?</p>
              <button
                type="button"
                onClick={handleRegister}
                className="inline-flex items-center justify-center rounded-lg border border-transparent bg-white px-3 py-2 text-sm font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
              >
                Create an Account
              </button>
            </div>
          </div>

          {authError ? (
            <p className="text-sm text-rose-500" role="alert">
              {authError}
            </p>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

LogInDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func,
  onRegister: PropTypes.func,
  registerHref: PropTypes.string,
  children: PropTypes.node,
};
