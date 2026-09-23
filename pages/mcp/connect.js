import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  PlugZap,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';

const PUBLIC_ENDPOINT = process.env.NEXT_PUBLIC_MCP_PUBLIC_URL || 'https://www.yuqi.site/mcp';
const ADMIN_ENDPOINT = process.env.NEXT_PUBLIC_MCP_ADMIN_URL || 'https://www.yuqi.site/mcp/admin';

const CLIENTS = [
  { id: 'claude', label: 'Claude', instruction: 'Add a custom connector and paste the endpoint below.' },
  { id: 'chatgpt', label: 'ChatGPT', instruction: 'Add an MCP app or custom connector with the endpoint below.' },
  { id: 'codex', label: 'Codex', instruction: 'Add the endpoint as a Streamable HTTP MCP server.' },
  { id: 'desktop', label: 'Cursor / VS Code', instruction: 'Create a remote MCP server entry using the endpoint below.' },
  { id: 'gemini', label: 'Gemini', instruction: 'Use the client\'s remote MCP connection settings with the endpoint below.' },
];

function CopyButton({ value, copied, onCopy }) {
  return (
    <button type="button" className="copy-button" onClick={() => onCopy(value)}>
      {copied ? <Check size={17} /> : <Clipboard size={17} />}
      {copied ? 'Copied' : 'Copy URL'}
    </button>
  );
}

export default function McpConnectPage() {
  const router = useRouter();
  const requestedAccess = router.query.access === 'public' ? 'public' : 'admin';
  const [access, setAccess] = useState(requestedAccess);
  const [client, setClient] = useState('claude');
  const [copiedValue, setCopiedValue] = useState('');

  const selectedClient = useMemo(
    () => CLIENTS.find((item) => item.id === client) || CLIENTS[0],
    [client]
  );
  const isAdmin = access === 'admin';
  const endpoint = isAdmin ? ADMIN_ENDPOINT : PUBLIC_ENDPOINT;

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(() => setCopiedValue(''), 1800);
    } catch {
      setCopiedValue('');
    }
  }

  return (
    <>
      <Head>
        <title>Connect to Yuqi Portfolio MCP</title>
        <meta
          name="description"
          content="Connect Claude, ChatGPT, Codex, Cursor, VS Code, Gemini, and other MCP clients to Yuqi Portfolio."
        />
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Head>

      <main className="connect-page">
        <header className="topbar">
          <Link href="/">
            <a className="brand" aria-label="Yuqi.site home">
              <span className="brand-mark"><PlugZap size={20} /></span>
              <span>YUQI.SITE</span>
            </a>
          </Link>
          <Link href="/mcp-guide">
            <a className="guide-link">Setup guide <ExternalLink size={15} /></a>
          </Link>
        </header>

        <section className="intro" aria-labelledby="connect-heading">
          <div className="status-line"><Sparkles size={15} /> Works with MCP-compatible AI clients</div>
          <h1 id="connect-heading">Connect your AI client</h1>
          <p>
            Choose the access level, copy one URL, and finish authorization in your browser.
            No API key needs to be created or pasted into chat.
          </p>
        </section>

        <section className="workspace" aria-label="MCP connection setup">
          <div className="access-picker" role="tablist" aria-label="Access level">
            <button
              type="button"
              role="tab"
              aria-selected={!isAdmin}
              className={!isAdmin ? 'active' : ''}
              onClick={() => setAccess('public')}
            >
              <UserRoundCheck size={19} />
              <span><strong>Public MCP</strong><small>No sign-in required</small></span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isAdmin}
              className={isAdmin ? 'active' : ''}
              onClick={() => setAccess('admin')}
            >
              <LockKeyhole size={19} />
              <span><strong>Admin MCP</strong><small>OAuth and managed role required</small></span>
            </button>
          </div>

          <div className="setup-grid">
            <section className="setup-main">
              <div className="section-heading">
                <span>01</span>
                <div>
                  <h2>Choose your client</h2>
                  <p>The same endpoint works across compatible clients.</p>
                </div>
              </div>

              <div className="client-list" role="list" aria-label="Supported AI clients">
                {CLIENTS.map((item) => (
                  <button
                    type="button"
                    role="listitem"
                    key={item.id}
                    className={client === item.id ? 'selected' : ''}
                    onClick={() => setClient(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="section-heading endpoint-heading">
                <span>02</span>
                <div>
                  <h2>Add the MCP endpoint</h2>
                  <p>{selectedClient.instruction}</p>
                </div>
              </div>

              <div className="endpoint-box">
                <code>{endpoint}</code>
                <CopyButton value={endpoint} copied={copiedValue === endpoint} onCopy={copy} />
              </div>

              <div className="section-heading authorize-heading">
                <span>03</span>
                <div>
                  <h2>{isAdmin ? 'Sign in and approve' : 'Start asking questions'}</h2>
                  <p>
                    {isAdmin
                      ? 'Your AI client opens the secure consent screen. Sign in with an existing administrator account, review access, then approve.'
                      : 'The client can immediately discover read-only portfolio, project, article, and architecture tools.'}
                  </p>
                </div>
              </div>

              {isAdmin ? (
                <div className="actions">
                  <Link href="/admin/login?redirect=%2Fmcp%2Fconnect%3Faccess%3Dadmin">
                    <a className="primary-action">Sign in to verify access <ArrowRight size={17} /></a>
                  </Link>
                  <span>Authorization begins inside your AI client.</span>
                </div>
              ) : (
                <div className="ready-message">
                  <CheckCircle2 size={20} />
                  <span><strong>Ready to connect</strong> Public tools remain read-only and privacy filtered.</span>
                </div>
              )}
            </section>

            <aside className="trust-panel" aria-label="Connection security">
              <ShieldCheck size={25} />
              <h2>{isAdmin ? 'Protected by design' : 'Safe public access'}</h2>
              <ul>
                {isAdmin ? (
                  <>
                    <li><Check size={16} /> Existing accounts only; sign-up is disabled</li>
                    <li><Check size={16} /> Server-managed administrator roles</li>
                    <li><Check size={16} /> Explicit confirmation for protected writes</li>
                    <li><Check size={16} /> Audited tool calls and operation history</li>
                  </>
                ) : (
                  <>
                    <li><Check size={16} /> Read-only portfolio tools</li>
                    <li><Check size={16} /> No private administrator data</li>
                    <li><Check size={16} /> Privacy-filtered responses</li>
                    <li><Check size={16} /> No account or API key required</li>
                  </>
                )}
              </ul>
              <p>
                Opening this URL in a browser shows this guide. MCP protocol requests continue directly to the server.
              </p>
            </aside>
          </div>
        </section>

        <footer>
          <span>Need detailed client instructions?</span>
          <Link href="/mcp-guide"><a>Open the MCP setup guide <ArrowRight size={15} /></a></Link>
        </footer>
      </main>

      <style jsx global>{`
        :global(html) { background: #f4f7f6; }
        :global(body) { margin: 0; letter-spacing: 0; }
        .connect-page {
          min-height: 100vh;
          min-height: 100dvh;
          color: #18201e;
          background: #f4f7f6;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .connect-page h1, .connect-page h2, .connect-page button { font-family: inherit; }
        .connect-page button::before, .connect-page button::after {
          display: none !important;
          content: none !important;
        }
        .topbar {
          height: 68px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 max(24px, calc((100vw - 1120px) / 2));
          border-bottom: 1px solid #dfe7e4;
          background: rgba(255, 255, 255, 0.88);
        }
        .brand, .guide-link { display: inline-flex; align-items: center; text-decoration: none; }
        .brand { gap: 10px; color: #17201e; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; }
        .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; color: #087f68; border: 1px solid #a9d8cd; background: #e6f6f1; }
        .guide-link { gap: 7px; color: #45605a; font-size: 13px; font-weight: 700; }
        .intro { max-width: 1120px; margin: 0 auto; padding: 72px 24px 38px; }
        .status-line { display: inline-flex; align-items: center; gap: 7px; color: #087f68; font-size: 12px; font-weight: 800; text-transform: uppercase; }
        h1 { max-width: 720px; margin: 15px 0 13px; color: #111816; font-size: clamp(38px, 5vw, 62px); line-height: 1.02; letter-spacing: 0; }
        .intro p { max-width: 670px; margin: 0; color: #5a6a66; font-size: 17px; line-height: 1.65; }
        .workspace { max-width: 1120px; margin: 0 auto; padding: 0 24px 58px; }
        .access-picker { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #ccd9d5; background: #e7ecea; }
        .access-picker button { min-height: 82px; display: flex; align-items: center; gap: 13px; padding: 16px 20px; border: 0; background: transparent !important; color: #5d6e69; text-align: left; cursor: pointer; }
        .access-picker button:first-child { border-right: 1px solid #ccd9d5; }
        .access-picker button.active { color: #075f51; background: #ffffff !important; box-shadow: inset 0 -3px 0 #0a8f76; }
        .access-picker span { display: flex; flex-direction: column; gap: 3px; }
        .access-picker strong { color: inherit; font-size: 15px; }
        .access-picker small { color: #71827d; font-size: 12px; }
        .setup-grid { display: grid; grid-template-columns: minmax(0, 1fr) 310px; border: 1px solid #ccd9d5; border-top: 0; background: #fff; }
        .setup-main { padding: 36px; }
        .section-heading { display: flex; align-items: flex-start; gap: 14px; }
        .section-heading > span { flex: 0 0 auto; color: #0a8f76; font: 800 11px/28px ui-monospace, monospace; }
        .section-heading h2, .trust-panel h2 { margin: 0; color: #18201e; font-size: 18px; letter-spacing: 0; }
        .section-heading p { margin: 5px 0 0; color: #71817d; font-size: 13px; line-height: 1.5; }
        .client-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 19px 0 32px 42px; }
        .client-list button { min-height: 38px; padding: 0 13px; border: 1px solid #cbd8d4; background: #fff !important; color: #52645f; font-size: 12px; font-weight: 750; cursor: pointer; }
        .client-list button.selected { border-color: #0a8f76; color: #075f51; background: #e9f7f3 !important; }
        .endpoint-heading { margin-top: 2px; }
        .endpoint-box { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin: 18px 0 32px 42px; }
        .endpoint-box code { min-width: 0; display: flex; align-items: center; padding: 0 14px; overflow-wrap: anywhere; border: 1px solid #cbd8d4; background: #f5f8f7; color: #273b36; font: 650 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .copy-button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid #087f68; background: #087f68 !important; color: #fff; font-weight: 800; cursor: pointer; }
        .authorize-heading { margin-top: 2px; }
        .actions { display: flex; align-items: center; gap: 15px; margin: 20px 0 0 42px; }
        .primary-action { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 0 17px; color: #fff; background: #17201e; font-size: 13px; font-weight: 800; text-decoration: none; }
        .actions span { color: #7b8985; font-size: 11px; }
        .ready-message { display: flex; align-items: center; gap: 11px; margin: 20px 0 0 42px; padding: 13px 15px; color: #176b5b; background: #eaf7f3; font-size: 12px; }
        .ready-message span { display: flex; flex-direction: column; gap: 2px; }
        .trust-panel { padding: 36px 28px; border-left: 1px solid #dce5e2; background: #f5f8f7; }
        .trust-panel > :global(svg) { color: #0a8f76; }
        .trust-panel h2 { margin-top: 15px; }
        .trust-panel ul { display: grid; gap: 13px; margin: 23px 0; padding: 0; list-style: none; }
        .trust-panel li { display: flex; align-items: flex-start; gap: 9px; color: #52625e; font-size: 12px; line-height: 1.5; }
        .trust-panel li :global(svg) { flex: 0 0 auto; margin-top: 1px; color: #0a8f76; }
        .trust-panel p { margin: 25px 0 0; padding-top: 20px; border-top: 1px solid #d8e2df; color: #7a8985; font-size: 11px; line-height: 1.6; }
        footer { max-width: 1072px; display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 0 auto; padding: 24px 24px 42px; border-top: 1px solid #d7e1de; color: #6f7f7b; font-size: 12px; }
        footer a { display: inline-flex; align-items: center; gap: 7px; color: #087f68; font-weight: 800; text-decoration: none; }
        button, a { border-radius: 6px; }
        button:focus-visible, a:focus-visible { outline: 3px solid rgba(10, 143, 118, 0.28); outline-offset: 2px; }
        @media (max-width: 760px) {
          .topbar { height: 60px; padding: 0 16px; }
          .intro { padding: 44px 18px 28px; }
          h1 { font-size: 39px; }
          .intro p { font-size: 15px; }
          .workspace { padding: 0 14px 38px; }
          .access-picker { grid-template-columns: 1fr; }
          .access-picker button { min-height: 70px; padding: 13px 16px; }
          .access-picker button:first-child { border-right: 0; border-bottom: 1px solid #ccd9d5; }
          .setup-grid { grid-template-columns: 1fr; }
          .setup-main { padding: 28px 20px; }
          .client-list, .endpoint-box, .actions, .ready-message { margin-left: 0; }
          .client-list { margin-top: 17px; }
          .endpoint-box { grid-template-columns: 1fr; }
          .endpoint-box code { min-height: 56px; }
          .copy-button { width: 100%; }
          .actions { align-items: stretch; flex-direction: column; }
          .primary-action { width: 100%; box-sizing: border-box; }
          .trust-panel { border-top: 1px solid #dce5e2; border-left: 0; }
          footer { align-items: flex-start; flex-direction: column; margin: 0 18px; padding-left: 0; padding-right: 0; }
        }
      `}</style>
    </>
  );
}
