// pages/admin/login.js
// Admin login page. Validates the admin token against the Writer API.

import { useState } from 'react';
import { useRouter } from 'next/router';
import { validateAdminToken } from '../../src/lib/writerApi';

export default function AdminLogin() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token.trim()) { setError('Token is required'); return; }
    setLoading(true);
    setError('');
    try {
      const valid = await validateAdminToken(token.trim());
      if (valid) {
        sessionStorage.setItem('admin_token', token.trim());
        router.replace('/admin');
      } else {
        setError('Invalid admin token');
      }
    } catch {
      setError('Could not reach the Writer API. Is it running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Admin Panel</h1>
        <p className="login-subtitle">Enter your admin token to continue</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Admin Token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter admin token"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Verifying…' : 'Log In'}
          </button>
        </form>
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
          color: #64748b;
          font-size: 0.9rem;
          margin: 0 0 32px;
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
      `}</style>
    </div>
  );
}
