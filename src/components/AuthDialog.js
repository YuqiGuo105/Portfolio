import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../supabase/supabaseClient';

export default function AuthDialog({ next = '/', onClose }) {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        if (onClose) onClose();
        router.replace(next);
      }
    });
  }, [next, router, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let res;
      if (mode === 'login') {
        res = await supabase.auth.signInWithPassword({ email, password });
      } else {
        res = await supabase.auth.signUp({ email, password });
      }
      if (res.error) throw res.error;
      if (onClose) onClose();
      router.replace(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={(e) => e.target.classList.contains('auth-overlay') && onClose?.() }>
      <div className="auth-dialog">
        <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>
        {error && <p className="auth-error">{error}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
        <p className="auth-toggle">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
      <style jsx>{`
        .auth-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .auth-dialog {
          background: #fff;
          padding: 2rem;
          border-radius: 8px;
          width: 100%;
          max-width: 400px;
        }
        .auth-form input {
          width: 100%;
          padding: 0.5rem;
          margin-bottom: 1rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .auth-form button {
          width: 100%;
          padding: 0.5rem;
          background: #0070f3;
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .auth-error {
          color: red;
          margin-bottom: 1rem;
        }
        .auth-toggle button {
          background: none;
          border: none;
          color: #0070f3;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
