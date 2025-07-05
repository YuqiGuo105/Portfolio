import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../supabase/supabaseClient';

export default function AuthDialog({ next = '/', onClose }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace(next);
      }
    });
  }, [next, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) throw err;
      console.log('Login successful');
      router.replace(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="auth-overlay"
      onClick={(e) =>
        e.target.classList.contains('auth-overlay') && onClose?.()
      }
    >
      <div className="auth-dialog">
        <button className="close-btn" onClick={onClose} aria-label="Close">&times;</button>
        <h2>Login</h2>
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
            Login
          </button>
        </form>
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
          animation: fade-in 0.3s ease-out;
        }
        .auth-dialog {
          position: relative;
          background: #fff;
          padding: 2rem;
          border-radius: 8px;
          width: 100%;
          max-width: 400px;
          animation: slide-down 0.3s ease-out;
        }
        .auth-form input {
          width: 100%;
          padding: 0.5rem;
          margin-bottom: 1rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .close-btn {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          background: none;
          border: none;
          font-size: 1.25rem;
          cursor: pointer;
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

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slide-down {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        /* dark mode overrides */
        body.dark-skin .auth-dialog {
          background: #1f2937;
          color: #f3f4f6;
        }
        body.dark-skin .auth-form input {
          background: #111827;
          border-color: #374151;
          color: #f3f4f6;
        }
        body.dark-skin .auth-form input::placeholder {
          color: #9ca3af;
        }
        body.dark-skin .auth-form button {
          background: #2563eb;
        }
      `}</style>
    </div>
  );
}
