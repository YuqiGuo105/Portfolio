import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowUpRight, Check, CheckCircle2, LockKeyhole, Monitor, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../../src/supabase/supabaseClient';
import { verifyAdminSession } from '../../src/lib/writerApi';
import { authorizationHandoff, canDecideConsent, consentError, oauthClientName } from '../../src/lib/oauthConsent.mjs';

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
  const [restartRequired, setRestartRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [handoff, setHandoff] = useState(null);
  const decidingRef = useRef(false);

  function failAuthorization(cause) {
    const failure = consentError(cause);
    setDetails(null);
    setError(failure.message);
    setRestartRequired(failure.restartRequired);
    setStatus('');
    setDecision('');
  }

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
      setDetails(null);
      setError('');
      setRestartRequired(false);
      setHandoff(null);
      setStatus('Checking administrator access...');
      if (!authorizationId) {
        failAuthorization({ code: 'invalid_authorization_id' });
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;
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
        failAuthorization(detailsError);
        return;
      }
      if (data?.redirect_url) {
        setHandoff(authorizationHandoff(data));
        setStatus('');
        return;
      }
      if (data?.authorization_id !== authorizationId) {
        failAuthorization({ code: 'invalid_authorization_id' });
        return;
      }
      setDetails(data);
      setStatus('');
    }

    loadAuthorization().catch((loadError) => {
      if (!active) return;
      failAuthorization(loadError);
    });
    return () => { active = false; };
  }, [authorizationId, router, router.isReady, attempt]);

  async function decide(action) {
    if (decidingRef.current || !canDecideConsent({ details, authorizationId, status, error, decision })) return;
    decidingRef.current = true;
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
      if (action === 'deny') {
        navigateToClient(data);
      } else {
        setHandoff(authorizationHandoff(data, details.client?.name));
        setDecision('');
      }
    } catch (decisionError) {
      failAuthorization(decisionError);
    } finally {
      decidingRef.current = false;
    }
  }

  const scopes = String(details?.scope || '')
    .split(/\s+/)
    .filter(Boolean);

  return (
    <main className="oauth-page">
      <Head>
        <title>{`${handoff ? 'Authorization approved' : 'Connect an AI client'} | Yuqi Admin`}</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <section className="consent-card" aria-busy={Boolean(status || decision)}>
        <div className="brand-row">
          <div className="brand-mark"><LockKeyhole size={24} /></div>
          <div>
            <p className="eyebrow">YUQI.SITE ADMIN</p>
            <h1>{handoff ? 'Authorization approved' : 'Connect an AI client'}</h1>
          </div>
        </div>

        {status && <p className="status">{status}</p>}
        {error && <div className="error" role="alert">
          <strong>{restartRequired ? 'Connection request expired' : 'Connection unavailable'}</strong>
          <p>{error}</p>
          {restartRequired
            ? <Link href="/mcp-guide">Connection setup guide</Link>
            : <button type="button" className="deny" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
        </div>}
        {error && admin && <div className="identity">
          <span>You are still signed in</span>
          <strong>{admin.email}</strong>
          <small>{admin.role || 'ADMIN'} · administrator login is separate from client authorization</small>
        </div>}

        {handoff && !error && (
          <div className="handoff" role="status">
            <div className="success-mark"><CheckCircle2 size={38} strokeWidth={1.6} /></div>
            <h2>Ready to return to {handoff.clientName}.</h2>
            <p>Your administrator access is approved. Continue to let the app finish connecting.</p>
            <ol className="connection-steps" aria-label="Connection progress">
              <li><Check size={18} /><span>Signed in</span><strong>Verified</strong></li>
              <li><Check size={18} /><span>Access approved</span><strong>Verified</strong></li>
              <li className="pending"><Monitor size={18} /><span>Client connection</span><strong>Next</strong></li>
            </ol>
            <button type="button" className="approve continue" onClick={() => window.location.assign(handoff.redirectUrl)}>
              Return to {handoff.clientName}<ArrowUpRight size={18} />
            </button>
            <p className="handoff-note">Destination: {handoff.destination}. The connection is complete only when your app confirms it.</p>
          </div>
        )}

        {!handoff && details?.authorization_id === authorizationId && !error && !status && (
          <>
            <div className="client">
              <ShieldCheck size={28} />
              <div>
                <strong>{oauthClientName(details.client?.name)}</strong>
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
                disabled={!canDecideConsent({ details, authorizationId, status, error, decision })}
              >
                <X size={18} /> Deny
              </button>
              <button
                type="button"
                className="approve"
                onClick={() => decide('approve')}
                disabled={!canDecideConsent({ details, authorizationId, status, error, decision })}
              >
                <Check size={18} /> {decision === 'approve' ? 'Connecting...' : 'Allow access'}
              </button>
            </div>
          </>
        )}
      </section>
      <p className="page-footer"><LockKeyhole size={13} /> Secure authorization on yuqi.site</p>

      <style jsx>{`
        .oauth-page {
          min-height: 100vh;
          min-height: 100dvh;
          display: grid;
          justify-items: center;
          align-content: center;
          gap: 20px;
          padding: 32px 24px;
          background: #f4f7f6;
          color: #263a35;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          letter-spacing: 0;
        }
        .consent-card {
          width: min(100%, 560px);
          padding: 36px;
          border: 1px solid #dce5e1;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 12px 36px rgba(25, 53, 43, 0.06);
        }
        .brand-row, .client, .actions, .identity { display: flex; }
        .brand-row { align-items: center; gap: 14px; }
        .brand-mark {
          width: 48px; height: 48px; display: grid; place-items: center;
          flex: 0 0 48px;
          color: #157664; border: 1px solid #cfe5dc; border-radius: 8px;
          background: #eff8f3;
        }
        .eyebrow { margin: 0 0 5px; color: #51726a; font: 700 11px/1.2 ui-monospace, monospace; letter-spacing: 0; }
        h1 { margin: 0; color: #20352e; font-family: inherit; font-size: 24px; font-weight: 600; line-height: 1.3; letter-spacing: 0; }
        .status { margin: 30px 0 0; color: #61746c; }
        .error { margin-top: 24px; padding: 16px; border-left: 3px solid #bd4848; background: #fff5f3; color: #873838; }
        .error p { margin: 10px 0; font-size: 14px; line-height: 1.6; }
        .error :global(a) { color: #176b58; }
        .client { align-items: center; gap: 15px; margin-top: 30px; padding: 18px; border-top: 1px solid rgba(148, 163, 184, 0.18); border-bottom: 1px solid rgba(148, 163, 184, 0.18); }
        .client img { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; }
        .client strong, .client span { display: block; }
        .client :global(svg) { flex: 0 0 auto; color: #157664; }
        .client strong { color: #20352e; font-size: 17px; overflow-wrap: anywhere; }
        .client span { margin-top: 4px; color: #61746c; font-size: 13px; line-height: 1.5; }
        .access-box { margin-top: 24px; }
        .access-box p { margin: 0 0 12px; color: #263a35; font-size: 14px; font-weight: 600; }
        ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
        li { display: flex; align-items: flex-start; gap: 9px; color: #52665e; font-size: 13px; line-height: 1.6; }
        li :global(svg) { flex: 0 0 auto; margin-top: 1px; color: #157664; }
        .scopes { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 22px; }
        .scopes span { padding: 5px 8px; border: 1px solid #dce5e1; border-radius: 4px; color: #52665e; font: 600 11px/1 ui-monospace, monospace; }
        .identity { flex-direction: column; gap: 4px; margin-top: 24px; padding: 14px 0; border-top: 1px solid #e4ebe7; }
        .identity span, .identity small { color: #61746c; font-size: 12px; }
        .identity strong { color: #263a35; font-size: 14px; overflow-wrap: anywhere; }
        .actions { justify-content: flex-end; gap: 10px; margin-top: 28px; }
        button { min-height: 46px; height: auto; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 17px; border-radius: 6px; font-family: inherit; font-size: 14px; font-weight: 600; line-height: 1.4; letter-spacing: 0; white-space: normal; cursor: pointer; }
        button::before, button::after { display: none !important; content: none !important; }
        button:disabled { cursor: wait; opacity: 0.65; }
        button:focus-visible { outline: 3px solid #6ca794; outline-offset: 3px; }
        .deny { border: 1px solid #b9cbc2; background: transparent; color: #3c5549; }
        .approve { border: 1px solid #176b58; background: #176b58; color: #fff; }
        .approve:hover { background: #105343; }
        .handoff { margin-top: 30px; }
        .success-mark { color: #16805f; margin-bottom: 16px; }
        h2 { color: #20352e; font-family: inherit; font-size: 22px; font-weight: 600; line-height: 1.4; margin: 0 0 10px; overflow-wrap: anywhere; }
        .handoff p { font-size: 14px; line-height: 1.65; color: #61746c; margin: 0; }
        .connection-steps { list-style: none; margin: 24px 0; padding: 0; border-top: 1px solid #e4ebe7; }
        .connection-steps li { align-items: center; padding: 14px 0; margin: 0; border-bottom: 1px solid #e4ebe7; }
        .connection-steps span { flex: 1; }
        .connection-steps strong { color: #157664; font-size: 12px; font-weight: 500; }
        .connection-steps .pending strong, .pending :global(svg) { color: #92662b; }
        .continue { width: 100%; overflow-wrap: anywhere; }
        .continue :global(svg) { flex-shrink: 0; }
        .handoff .handoff-note { font-size: 12px; margin-top: 14px; overflow-wrap: anywhere; }
        .page-footer { display: flex; align-items: center; gap: 7px; color: #61746c; font-size: 12px; margin: 0; }
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
