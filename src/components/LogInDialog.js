// src/components/LogInDialog.js
'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

export default function LogInDialog({
                                      open,
                                      title = 'Log In Required',
                                      onClose,
                                      onConfirm,
                                      onRegister,
                                      registerHref = '#contact-section',
                                      children,
                                    }) {
  const ref = useRef(null);
  const toastTimerRef = useRef(null);
  const [toastHost, setToastHost] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // sync open -> <dialog> with graceful transitions
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const card = el.querySelector('.login-card');

    if (open) {
      if (!el.open) {
        el.showModal();
      }
      requestAnimationFrame(() => {
        el.removeAttribute('data-closing');
      });
      return undefined;
    }

    if (!el.open || !card) return undefined;

    el.setAttribute('data-closing', 'true');

    const handleAnimationEnd = () => {
      card.removeEventListener('animationend', handleAnimationEnd);
      el.removeAttribute('data-closing');
      if (el.open) el.close();
    };

    card.addEventListener('animationend', handleAnimationEnd);
    return () => card.removeEventListener('animationend', handleAnimationEnd);
  }, [open]);

  useEffect(() => {
    if (open) {
      setUsername('');
      setPassword('');
      setErrorMessage('');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const el = document.createElement('div');
    el.id = 'login-dialog-toast-root';
    document.body.appendChild(el);
    setToastHost(el);

    return () => {
      clearTimeout(toastTimerRef.current);
      if (el.parentNode) el.parentNode.removeChild(el);
      setToastHost(null);
    };
  }, []);

  const showToast = (message) => {
    setToastMessage(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 3200);
  };

  // ESC / native close → onClose
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const handler = () => onClose && onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  const onBackdropClick = (e) => {
    if (e.target === ref.current) onClose && onClose();
  };

  const handleLogin = async () => {
    if (!onConfirm) {
      if (onClose) onClose();
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      const result = await onConfirm(username, password);
      if (result === false || result?.error) {
        setErrorMessage(result?.error || 'Invalid username or password.');
        return;
      }
      if (onClose) onClose();
    } catch (err) {
      setErrorMessage(err?.message || 'Invalid username or password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await handleLogin();
  };

  const handleRegister = () => {
    let shouldShowToast = false;
    if (onRegister) {
      onRegister();
      shouldShowToast = true;
    } else if (registerHref && typeof window !== 'undefined') {
      shouldShowToast = true;
      if (registerHref.startsWith('#')) {
        const target = document.querySelector(registerHref);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        window.location.href = registerHref;
      }
    }
    if (shouldShowToast) {
      showToast('Please Connect Yuqi to register');
    }
    if (onClose) onClose();
  };

  return (
    <>
      <dialog
        ref={ref}
        onClick={onBackdropClick}
        aria-labelledby="login-dialog-title"
        className="login-dialog"
      >
        <div className="login-card" role="document">
          <button
            onClick={onClose}
            type="button"
            aria-label="Close dialog"
            className="close-button"
          >
            ×
          </button>
          <header className="login-header">
            <h2 id="login-dialog-title">{title}</h2>
            <p>{children ?? 'Please log in to continue.'}</p>
          </header>

          <form onSubmit={handleSubmit} className="login-form">
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {errorMessage && <p className="error-text">{errorMessage}</p>}
            <button type="submit" className="login-button" disabled={submitting}>
              {submitting ? 'LOGGING IN…' : 'LOG IN'}
            </button>
          </form>

          <div className="signup-row">
            <span>Don’t have an account?</span>
            <button type="button" className="signup-button" onClick={handleRegister}>
              Sign up
            </button>
          </div>
        </div>

        <style jsx>{`
        .login-dialog {
          --card-bg: #ffffff;
          --card-text: #0f172a;
          --muted-text: #475569;
          --input-border: rgba(148, 163, 184, 0.6);
          --input-placeholder: rgba(100, 116, 139, 0.7);
          --button-bg: #38bdf8;
          --button-bg-hover: #0ea5e9;
          --button-bg-focus: rgba(14, 165, 233, 0.2);
          --outline-button: rgba(56, 189, 248, 0.35);
          border: none;
          padding: 0;
          background: transparent;
          width: min(92vw, 700px);
          max-width: 700px;
          border-radius: 28px;
        }

        .login-dialog::backdrop {
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(8px);
          transition: opacity 220ms ease;
        }

        .login-dialog[data-closing]::backdrop {
          opacity: 0;
        }

        .login-card {
          position: relative;
          background: var(--card-bg);
          color: var(--card-text);
          border-radius: 28px;
          box-shadow: 0 32px 80px rgba(15, 23, 42, 0.12);
          padding: 50px 40px;
          display: flex;
          flex-direction: column;
          gap: 32px;
          transition: background 180ms ease, color 180ms ease;
          animation: dialog-in 240ms ease forwards;
        }

        .login-dialog[data-closing] .login-card {
          animation: dialog-out 200ms ease forwards;
        }

        .close-button {
          position: absolute;
          top: 28px;
          right: 28px;
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: transparent;
          color: var(--muted-text);
          font-size: 24px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
          cursor: pointer;
        }

        .close-button:hover,
        .close-button:focus-visible {
          color: var(--card-text);
          background: rgba(241, 245, 249, 0.6);
          border-color: rgba(148, 163, 184, 0.55);
          outline: none;
        }

        .login-header {
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-top: 12px;
        }

        .login-header h2 {
          font-size: clamp(26px, 4vw, 32px);
          font-weight: 500;
          letter-spacing: 0.01em;
          margin: 0;
        }

        .login-header p {
          margin: 0;
          color: var(--muted-text);
          font-size: 16px;
          line-height: 1.6;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 14px;
          color: var(--muted-text);
        }

        .field span {
          font-weight: 500;
          letter-spacing: 0.01em;
        }

        .field input {
          height: 48px;
          border-radius: 14px;
          border: 1px solid var(--input-border);
          background: transparent;
          padding: 0 18px;
          font-size: 16px;
          color: var(--card-text);
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .field input::placeholder {
          color: var(--input-placeholder);
        }

        .field input:focus-visible {
          outline: none;
          border-color: rgba(56, 189, 248, 0.8);
          box-shadow: 0 0 0 3px var(--button-bg-focus);
        }

        .error-text {
          margin: 0;
          color: #dc2626;
          font-weight: 600;
        }

        .login-button {
          height: 56px;
          border-radius: 16px;
          border: none;
          background: var(--button-bg);
          color: #0c4a6e;
          font-weight: 600;
          letter-spacing: 0.08em;
          font-size: 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }

        .login-button:hover {
          background: var(--button-bg-hover);
          transform: translateY(-1px);
          box-shadow: 0 16px 30px rgba(14, 165, 233, 0.25);
        }
        .login-button:before {
          display: none;
        }
        .login-button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--button-bg-focus);
        }

        .signup-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 14px;
          font-size: 15px;
          color: var(--muted-text);
        }

        .signup-button {
          display: flex;
          height: 30px;
          align-items: center;
          justfy-content: center;
          border-radius: 999px;
          border: 1px solid var(--outline-button);
          background: transparent;
          color: var(--button-bg-hover);
          font-weight: 600;
          padding: 10px 20px;
          cursor: pointer;
          transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
        }

        .signup-button:hover,
        .signup-button:focus-visible {
          outline: none;
          background: rgba(125, 211, 252, 0.15);
          border-color: rgba(56, 189, 248, 0.55);
          color: #0369a1;
        }

        @keyframes dialog-in {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes dialog-out {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
        }

        @media (max-width: 640px) {
          .login-card {
            padding: 44px 28px 40px;
            border-radius: 24px;
            gap: 24px;
          }

          .close-button {
            top: 20px;
            right: 20px;
          }

          .login-button {
            width: 100%;
          }
        }

        :global(body.dark-skin) .login-dialog {
          --card-bg: rgba(15, 23, 42, 0.92);
          --card-text: #f8fafc;
          --muted-text: #cbd5f5;
          --input-border: rgba(148, 163, 184, 0.4);
          --input-placeholder: rgba(148, 163, 184, 0.75);
          --button-bg: #38bdf8;
          --button-bg-hover: #0ea5e9;
          --button-bg-focus: rgba(14, 165, 233, 0.35);
          --outline-button: rgba(125, 211, 252, 0.5);
        }

        :global(body.dark-skin) .close-button:hover,
        :global(body.dark-skin) .close-button:focus-visible {
          background: rgba(30, 41, 59, 0.9);
        }

        :global(body.dark-skin) .field input {
          background: rgba(15, 23, 42, 0.6);
        }
      `}</style>
      </dialog>

      {toastHost && toastMessage
        ? createPortal(
          <div className="login-toast" role="status" aria-live="polite">
            {toastMessage}
          </div>,
          toastHost,
        )
        : null}

      <style jsx global>{`
        #login-dialog-toast-root {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          justify-content: center;
          z-index: 2147483647;
          pointer-events: none;
        }

        #login-dialog-toast-root .login-toast {
          min-width: min(440px, 86vw);
          padding: 14px 18px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.9);
          color: #e2e8f0;
          box-shadow: 0 10px 40px rgba(15, 23, 42, 0.28);
          font-weight: 600;
          text-align: center;
          letter-spacing: 0.01em;
          pointer-events: auto;
          animation: toast-in 200ms ease-out;
        }

        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translate(-50%, 10px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </>
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
