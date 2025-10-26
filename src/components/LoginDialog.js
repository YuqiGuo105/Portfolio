import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase/supabaseClient";

const LoginDialog = ({ isOpen, onClose, onSuccess, redirectPath }) => {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    if (isOpen) {
      setMode("login");
      setEmail("");
      setPassword("");
      setError("");
      setMessage("");
      setLoading(false);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !isClient) {
    return null;
  }

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError("");
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}${redirectPath ?? ""}`
        : undefined;

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: redirectTo ? { redirectTo } : undefined,
      });

      if (authError) {
        throw authError;
      }

      // For OAuth we let the redirect happen automatically.
    } catch (authErr) {
      setError(authErr.message);
      setLoading(false);
    }
  };

  const handleEmailSubmit = async event => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        setLoading(false);
        onSuccess?.();
        onClose?.();
        return;
      }

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      setMessage("Registration successful! Check your email to confirm your account.");
      setMode("login");
      setPassword("");
      setLoading(false);
    } catch (authErr) {
      setError(authErr.message);
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(current => (current === "login" ? "signup" : "login"));
    setError("");
    setMessage("");
    setPassword("");
  };

  const dialog = (
    <div className="login-dialog-overlay" role="dialog" aria-modal="true">
      <div className="login-dialog">
        <button className="close" type="button" onClick={onClose} aria-label="Close login dialog">
          ×
        </button>

        <h2>{mode === "login" ? "Log in to continue" : "Create an account"}</h2>

        {error && <div className="feedback error">{error}</div>}
        {message && <div className="feedback message">{message}</div>}

        <button
          type="button"
          className="google-btn"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          Continue with Google
        </button>

        <div className="divider">
          <span>or</span>
        </div>

        <form onSubmit={handleEmailSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </label>

          <button type="submit" className="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <p className="switch-mode">
          {mode === "login" ? "Need an account?" : "Already registered?"}{" "}
          <button type="button" onClick={switchMode} className="link-btn">
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>

      <style jsx>{`
        .login-dialog-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 1.5rem;
        }

        .login-dialog {
          background: #fff;
          color: #222;
          max-width: 420px;
          width: 100%;
          border-radius: 12px;
          box-shadow: 0 20px 45px rgba(0, 0, 0, 0.2);
          padding: 2rem;
          position: relative;
        }

        h2 {
          margin: 0 0 1.5rem;
          font-size: 1.5rem;
          text-align: center;
        }

        .close {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          background: transparent;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: inherit;
        }

        .google-btn {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          background: #fff;
          color: #333;
          border: 1px solid #d1d5db;
          cursor: pointer;
          font-weight: 600;
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .google-btn:hover:not(:disabled) {
          background: #f3f4f6;
          transform: translateY(-1px);
        }

        .divider {
          text-align: center;
          color: #9ca3af;
          margin: 1.5rem 0;
          position: relative;
        }

        .divider::before,
        .divider::after {
          content: "";
          position: absolute;
          top: 50%;
          width: 40%;
          height: 1px;
          background: #e5e7eb;
        }

        .divider::before {
          left: 0;
        }

        .divider::after {
          right: 0;
        }

        form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .field span {
          font-weight: 600;
          font-size: 0.9rem;
        }

        .field input {
          padding: 0.75rem;
          border-radius: 6px;
          border: 1px solid #d1d5db;
          font-size: 1rem;
        }

        .field input:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        .submit {
          padding: 0.75rem;
          border-radius: 6px;
          background: linear-gradient(135deg, #4f46e5, #9333ea);
          color: #fff;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 20px rgba(79, 70, 229, 0.2);
        }

        .submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .switch-mode {
          text-align: center;
          margin-top: 1.5rem;
          font-size: 0.95rem;
        }

        .link-btn {
          background: none;
          border: none;
          color: #4f46e5;
          cursor: pointer;
          font-weight: 600;
          padding: 0;
        }

        .link-btn:hover {
          text-decoration: underline;
        }

        .feedback {
          border-radius: 6px;
          padding: 0.75rem 1rem;
          margin-bottom: 1rem;
          font-size: 0.9rem;
        }

        .feedback.error {
          background: rgba(239, 68, 68, 0.12);
          color: #b91c1c;
        }

        .feedback.message {
          background: rgba(34, 197, 94, 0.12);
          color: #047857;
        }

        @media (max-width: 480px) {
          .login-dialog {
            padding: 1.5rem;
          }
        }
      `}</style>
    </div>
  );

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  if (!portalTarget) {
    return null;
  }

  return createPortal(dialog, portalTarget);
};

export default LoginDialog;
