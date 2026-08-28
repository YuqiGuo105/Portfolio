import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../../src/supabase/supabaseClient';
import { verifyAdminSession } from '../../src/lib/writerApi';

const LOGIN_PATH = '/admin/login';

function redirectToLogin(router) {
  const redirect = router.asPath.startsWith('/') ? router.asPath : '/oauth/consent';
  return router.replace(`${LOGIN_PATH}?redirect=${encodeURIComponent(redirect)}`);
}

function navigateToClient(data) {
  if (!data?.redirect_url) throw new Error('OAuth server did not return a redirect URL.');
  window.location.assign(data.redirect_url);
}

export default function OAuthConsentPage() {
  const router = useRouter();
  const [details, setDetails] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('Checking administrator access...');
  const [error, setError] = useState('');
  const [decision, setDecision] = useState('');

  const authorizationId = useMemo(
    () => typeof router.query.authorization_id === 'string'
      ? router.query.authorization_id
      : '',
    [router.query.authorization_id]
  );

  useEffect(() => {
    if (!router.isReady) return undefined;
    let active = true;

    async function loadAuthorization() {
      if (!authorizationId) {
        setError('This authorization request is missing its authorization ID.');
        setStatus('');
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        await redirectToLogin(router);
        return;
      }

      const access = await verifyAdminSession();
      if (!active) return;
      if (!access.authorized) {
        await supabase.auth.signOut().catch(() => {});
        const reason = access.status === 401 ? 'session_expired' : 'unauthorized';
        await router.replace(
          `${LOGIN_PATH}?redirect=${encodeURIComponent(router.asPath)}&reason=${reason}`
        );
        return;
      }

      setAdmin(access.profile);
      setStatus('Loading authorization request...');
      const { data, error: detailsError } = await supabase.auth.oauth
        .getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message || 'Could not load the authorization request.');
        setStatus('');
        return;
      }
      if (data?.redirect_url) {
        navigateToClient(data);
        return;
      }
      setDetails(data);
      setStatus('');
    }

    loadAuthorization().catch((loadError) => {
      if (!active) return;
      setError(loadError?.message || 'Could not load the authorization request.');
      setStatus('');
    });
    return () => { active = false; };
  }, [authorizationId, router, router.isReady]);

  async function decide(action) {
    setDecision(action);
    setError('');
    try {
      const operation = action === 'approve'
        ? supabase.auth.oauth.approveAuthorization
        : supabase.auth.oauth.denyAuthorization;
      const { data, error: decisionError } = await operation.call(
        supabase.auth.oauth,
        authorizationId,
        { skipBrowserRedirect: true }
      );
      if (decisionError) throw decisionError;
      navigateToClient(data);
    } catch (decisionError) {
      setError(decisionError?.message || 'Could not complete the authorization request.');
      setDecision('');
    }
  }

  const scopes = String(details?.scope || '')
    .split(/\s+/)
    .filter(Boolean);

  return (
    <main className="oauth-page">
      <section className="consent-card" aria-busy={Boolean(status || decision)}>
        <div className="brand-row">
          <div className="brand-mark"><LockKeyhole size={24} /></div>
          <div>
            <p className="eyebrow">YUQI.SITE ADMIN</p>
            <h1>Connect an AI client</h1>
          </div>
        </div>

        {status && <p className="status">{status}</p>}
        {error && <div className="error" role="alert">{error}</div>}

        {details && (
          <>
            <div className="client">
              {details.client?.logo_uri ? (
                <img src={details.client.logo_uri} alt="" />
              ) : (
                <ShieldCheck size={28} />
              )}
              <div>
                <strong>{details.client?.name || 'AI client'}</strong>
                <span>wants to connect to the protected Portfolio Admin MCP endpoint.</span>
              </div>
            </div>

            <div className="access-box">
              <p>Once connected, the client can:</p>
              <ul>
                <li><Check size={17} /> Discover tools allowed by your managed admin role</li>
                <li><Check size={17} /> Read operational and content data through audited APIs</li>
                <li><Check size={17} /> Stage write actions that still require explicit confirmation</li>
              </ul>
            </div>

            {scopes.length > 0 && (
              <div className="scopes" aria-label="Requested permissions">
                {scopes.map((scope) => <span key={scope}>{scope}</span>)}
              </div>
            )}

            <div className="identity">
              <span>Signed in as</span>
              <strong>{admin?.email || details.user?.email}</strong>
              <small>{admin?.role || 'ADMIN'} · permissions remain server-managed</small>
            </div>

            <div className="actions">
              <button
                type="button"
                className="deny"
                onClick={() => decide('deny')}
                disabled={Boolean(decision)}
              >
                <X size={18} /> Deny
              </button>
              <button
                type="button"
                className="approve"
                onClick={() => decide('approve')}
                disabled={Boolean(decision)}
              >
                <Check size={18} /> {decision === 'approve' ? 'Connecting...' : 'Allow access'}
              </button>
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        .oauth-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #0f172a;
          color: #e2e8f0;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .consent-card {
          width: min(100%, 560px);
          padding: 36px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 8px;
          background: #172033;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
        }
        .brand-row, .client, .actions, .identity { display: flex; }
        .brand-row { align-items: center; gap: 14px; }
        .brand-mark {
          width: 48px; height: 48px; display: grid; place-items: center;
          color: #5eead4; border: 1px solid rgba(94, 234, 212, 0.45); border-radius: 8px;
          background: rgba(13, 148, 136, 0.12);
        }
        .eyebrow { margin: 0 0 3px; color: #5eead4; font: 700 11px/1.2 ui-monospace, monospace; letter-spacing: 0.14em; }
        h1 { margin: 0; color: #f8fafc; font-size: 25px; letter-spacing: 0; }
        .status { margin: 30px 0 0; color: #94a3b8; }
        .error { margin-top: 24px; padding: 12px 14px; border: 1px solid rgba(248, 113, 113, 0.45); background: rgba(127, 29, 29, 0.2); color: #fecaca; }
        .client { align-items: center; gap: 15px; margin-top: 30px; padding: 18px; border-top: 1px solid rgba(148, 163, 184, 0.18); border-bottom: 1px solid rgba(148, 163, 184, 0.18); }
        .client img { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; }
        .client strong, .client span { display: block; }
        .client strong { color: #f8fafc; font-size: 17px; }
        .client span { margin-top: 4px; color: #94a3b8; font-size: 13px; line-height: 1.5; }
        .access-box { margin-top: 24px; }
        .access-box p { margin: 0 0 12px; color: #cbd5e1; font-weight: 700; }
        ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
        li { display: flex; align-items: flex-start; gap: 9px; color: #aebbd0; font-size: 13px; line-height: 1.45; }
        li :global(svg) { flex: 0 0 auto; margin-top: 1px; color: #5eead4; }
        .scopes { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 22px; }
        .scopes span { padding: 5px 8px; border: 1px solid #334155; border-radius: 4px; color: #94a3b8; font: 600 11px/1 ui-monospace, monospace; }
        .identity { flex-direction: column; gap: 3px; margin-top: 24px; padding: 13px 15px; background: #0f172a; border-left: 3px solid #14b8a6; }
        .identity span, .identity small { color: #7f8da3; font-size: 11px; }
        .identity strong { color: #e2e8f0; font-size: 14px; overflow-wrap: anywhere; }
        .actions { justify-content: flex-end; gap: 10px; margin-top: 28px; }
        button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border-radius: 6px; font-weight: 750; cursor: pointer; }
        button::before, button::after { display: none !important; content: none !important; }
        button:disabled { cursor: wait; opacity: 0.65; }
        .deny { border: 1px solid #475569; background: transparent; color: #cbd5e1; }
        .approve { border: 1px solid #2dd4bf; background: #14b8a6; color: #062d2a; }
        @media (max-width: 560px) {
          .oauth-page { padding: 14px; }
          .consent-card { padding: 25px 20px; }
          .actions { display: grid; grid-template-columns: 1fr 1fr; }
          button { width: 100%; }
        }
      `}</style>
    </main>
  );
}
