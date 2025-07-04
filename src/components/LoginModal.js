import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../supabase/supabaseClient';

const LoginModal = ({ open, onClose, nextUrl = '/' }) => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  useEffect(() => {
    const esc = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      setEmail('');
      setPassword('');
      setError(null);
      handleClose();
      router.push(nextUrl);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={handleClose}>×</button>
        <h2>Login</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit}>
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
          <button type="submit">Sign in</button>
        </form>
      </div>
      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: #fff;
          padding: 1.5rem;
          border-radius: 8px;
          position: relative;
          max-width: 400px;
          width: 100%;
        }
        .close {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          border: none;
          background: none;
          font-size: 1.5rem;
          cursor: pointer;
        }
        .error {
          color: red;
          margin-bottom: 0.5rem;
        }
        form input {
          display: block;
          width: 100%;
          margin-bottom: 0.5rem;
          padding: 0.5rem;
        }
        form button {
          width: 100%;
          padding: 0.5rem;
        }
      `}</style>
    </div>
  );
};

export default LoginModal;
