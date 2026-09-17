import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy, LockKeyhole, Search, ShieldCheck, History } from 'lucide-react';
import SeoHead from '../src/components/SeoHead';
import styles from '../styles/McpGuide.module.css';

const SOURCE = 'https://github.com/YuqiGuo105/portfolio-mcp-server';
const PUBLIC_URL = 'https://www.yuqi.site/mcp';
const ADMIN_URL = PUBLIC_URL + '/admin';

function Endpoint({ label, value }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(value); setStatus('Copied'); }
    catch { setStatus('Copy unavailable. Select the endpoint text to copy it.'); }
  }
  return <div className={styles.endpoint}>
    <div><span>{label}</span><code>{value}</code></div>
    <button type="button" onClick={copy} aria-label={'Copy ' + label} title={'Copy ' + label}>
      {status === 'Copied' ? <Check size={18} /> : <Copy size={18} />}
    </button>
    <span className={styles.srOnly} role="status">{status}</span>
  </div>;
}

function Figure({ file, alt, caption, width, height, compact }) {
  const src = '/assets/images/mcp-guide/' + file;
  return <figure className={compact ? styles.compactFigure : styles.figure}>
    <a href={src} target="_blank" rel="noreferrer" aria-label={'Open full-size image: ' + alt}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" />
    </a>
    <figcaption>{caption} <a href={src} target="_blank" rel="noreferrer">Full size <ArrowUpRight size={13} /></a></figcaption>
  </figure>;
}

export default function McpGuidePage() {
  return <>
    <SeoHead title="Portfolio MCP Gateway" description="Explore portfolio knowledge in Claude and Codex, or connect as an authorized administrator to manage the platform. A visual guide with real product screenshots." url="/mcp-guide" />
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/"><a className={styles.brand}>YUQI.SITE</a></Link>
        <a href={SOURCE + '/blob/main/README.md'} target="_blank" rel="noreferrer">GitHub README <ArrowUpRight size={16} /></a>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p>ON THIS PAGE</p>
          <nav aria-label="Guide sections">
            <a href="#connect">01 <span>Public edition</span></a>
            <a href="#authorization">02 <span>Administrator edition</span></a>
            <a href="#architecture">03 <span>Behind the gateway</span></a>
          </nav>
          <a className={styles.setupLink} href={SOURCE + '/blob/main/docs/CLIENT_INTEGRATIONS.md'} target="_blank" rel="noreferrer">Client setup <ArrowUpRight size={14} /></a>
        </aside>
        <article className={styles.article}>
          <header className={styles.intro}>
            <span className={styles.eyebrow}>BUILT BY YUQI GUO</span>
            <h1>Portfolio MCP Gateway</h1>
            <p>Connect Claude and Codex to portfolio knowledge and controlled platform actions.</p>
            <div className={styles.highlights}>
              <div><Search size={19} /><strong>Answers with sources</strong></div>
              <div><ShieldCheck size={19} /><strong>Role-based access</strong></div>
              <div><History size={19} /><strong>Traceable operations</strong></div>
            </div>
          </header>

          <section id="connect" className={styles.section}>
            <header className={styles.sectionTitle}><span>01 / PUBLIC</span><h2>Explore the work. Ask your AI.</h2><p>Find projects, articles, architecture, and professional background. Read-only. No portfolio login required.</p></header>
            <Endpoint label="Public endpoint" value={PUBLIC_URL} />
            <p id="first-question" className={styles.example}>Try asking: <strong>Which project demonstrates Yuqi&apos;s distributed-systems experience? Link the evidence.</strong></p>
            <Figure file="codex-public-plugin.png" width={1429} height={1100} alt="Yuqi Portfolio plugin in Codex" caption="Codex: projects, writing, and professional background." />
            <Figure file="claude-public-tools.png" width={2056} height={1374} alt="Claude public connector showing read-only portfolio tools" caption="Claude: connected public tools. Private records stay excluded." />
          </section>

          <section id="authorization" className={styles.section}>
            <header className={styles.sectionTitle}><span>02 / ADMINISTRATOR</span><h2>Operate with permission.</h2><p>Inspect visitor activity, Chat Agent answers, and failed tasks. Manage content, knowledge, and alert rules through permitted tools.</p></header>
            <div className={styles.accessNote}><LockKeyhole size={20} /><p><strong>Authorized administrator login required.</strong> Signing in alone does not grant an admin role. Protected writes retain their approval requirements.</p></div>
            <Endpoint label="Admin endpoint" value={ADMIN_URL} />
            <ol className={styles.steps}><li>Add the admin endpoint.</li><li>Sign in with an authorized account.</li><li>Approve the connection in the consent screen.</li></ol>
            <Figure file="admin-sign-in.png" width={390} height={640} compact alt="Administrator sign-in with email and Google" caption="Sign in first. Public registration is disabled." />
            <Figure file="claude-admin-connector-full.png" width={1650} height={1364} alt="Claude administrator connector showing read and write permissions after authorization" caption="After authorization: available tools follow the account's managed role." />
          </section>

          <section id="architecture" className={styles.section}>
            <header className={styles.sectionTitle}><span>03 / ENGINEERING</span><h2>Behind the gateway.</h2><p>The Node.js edge connects AI clients. The Java gateway and backend services enforce permissions, track outcomes, and own business data.</p></header>
            <Figure file="public-mcp-edge.svg" width={1600} height={720} alt="Architecture of the MCP edge, public and admin access, gateway and backend services" caption="Separate access paths. Shared validation and operation tracking." />
            <p className={styles.reliability}><strong>Designed for recoverability:</strong> validated requests, stable idempotency keys, persisted outcomes, and audit trails. Uncertain writes require reconciliation before retry.</p>
          </section>

          <footer id="tools" className={styles.footer}>
            <h2>Go deeper</h2>
            <div><a href={SOURCE + '/blob/main/docs/CLIENT_INTEGRATIONS.md'}>Connect a client <ArrowUpRight size={14} /></a><a href={SOURCE + '/blob/main/docs/ADMIN_WORKSPACE.md'}>Admin workspace <ArrowUpRight size={14} /></a><a href={SOURCE + '/blob/main/docs/DURABLE_OPERATIONS.md'}>Recovery design <ArrowUpRight size={14} /></a><a id="troubleshooting" href={SOURCE + '/blob/main/docs/CONNECTION_DIAGNOSTICS.md'}>Troubleshooting <ArrowUpRight size={14} /></a></div>
            <p>Real product screenshots. Tool counts and client capabilities vary by release. MCP means Model Context Protocol.</p>
          </footer>
        </article>
      </div>
    </main>
  </>;
}
