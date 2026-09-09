import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy, LockKeyhole, PlugZap } from 'lucide-react';
import SeoHead from '../src/components/SeoHead';
import styles from '../styles/McpGuide.module.css';

const PUBLIC_URL = 'https://www.yuqi.site/mcp';
const ADMIN_URL = `${PUBLIC_URL}/admin`;
const IMAGE_SIZES = { 'claude-public-tools.png': [2056, 1374], 'codex-yuqi-portfolio-plugin-v2.png': [1616, 973], 'admin-sign-in.png': [960, 900], 'claude-admin-write-permissions.png': [810, 520] };
const SOURCE = 'https://github.com/YuqiGuo105/portfolio-mcp-server';
const sections = [['authorization', 'Administrator access'], ['connect', 'Connect a client'], ['first-question', 'Ask your first question'], ['tools', 'Public tool reference'], ['troubleshooting', 'Troubleshooting']];
const tools = [
  ['search_portfolio', 'Start with a topic', 'Search across projects, articles, life writing, and professional experience.'],
  ['search_projects', 'Find a relevant system', 'Narrow the project search by technology or engineering problem.'],
  ['get_project', 'Read project evidence', 'Retrieve a project’s description, technical details, and canonical link.'],
  ['get_project_architecture', 'Inspect the design', 'Retrieve authored architecture diagrams and service boundaries for a project.'],
  ['search_articles', 'Find technical writing', 'Search published articles by keyword or topic.'],
  ['get_article', 'Read an article', 'Retrieve a published article and its source link.'],
  ['get_profile', 'Understand the background', 'Read public professional experience, education, and skills.'],
];

function CopyBlock({ children, label = 'Copy' }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(children); setStatus('Copied'); }
    catch { setStatus('Select and copy the text below.'); }
  }
  return <div className={styles.copyBlock}>
    <div className={styles.codeBar}><span>{label}</span><button type="button" onClick={copy} aria-label={`Copy ${label}`}>
      {status === 'Copied' ? <Check size={15} /> : <Copy size={15} />} {status === 'Copied' ? 'Copied' : 'Copy'}
    </button></div>
    <pre><code>{children}</code></pre><span className={styles.srOnly} role="status">{status}</span>
  </div>;
}

function Figure({ file, alt, number, children }) {
  const src = file === 'codex-yuqi-portfolio-plugin-v2.png'
    ? `/assets/images/${file}`
    : `/assets/images/mcp-guide/${file}`;
  return <figure className={styles.figure}>
    {file === 'claude-admin-write-permissions.png' && <div className={styles.permissionHeading}><div><span>ADMINISTRATOR TOOLS</span><strong>Write actions with explicit approval</strong></div><span className={styles.approvalBadge}><LockKeyhole size={15} /> Needs approval</span></div>}
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size image: ${alt}`}><img src={src} alt={alt} width={IMAGE_SIZES[file][0]} height={IMAGE_SIZES[file][1]} loading="lazy" /></a>
    <figcaption><span>FIG. {number}</span> {children} <a href={src} target="_blank" rel="noreferrer">View full size <ArrowUpRight size={13} /></a></figcaption>
  </figure>;
}

function SectionTitle({ number, title, children }) {
  return <header className={styles.sectionTitle}><span>{number}</span><div><h2>{title}</h2>{children && <p>{children}</p>}</div></header>;
}

export default function McpGuidePage() {
  return <>
    <SeoHead title="MCP Connection Guide" description="A visual guide to connecting Yuqi Portfolio MCP in Claude and Codex, exploring seven public tools, and authorizing administrator access." url="/mcp-guide" />
    <main className={styles.page}>
      <div className={styles.topbar}><Link href="/"><a className={styles.brand}>YUQI<span>.SITE</span></a></Link><span className={styles.docLabel}>Developer guides / MCP</span><a href={SOURCE} target="_blank" rel="noreferrer">Source code <ArrowUpRight size={15} /></a></div>
      <div className={styles.layout}>
        <aside className={styles.sidebar}><p>IN THIS GUIDE</p><nav aria-label="Guide sections">{sections.map(([id, title], i) => <a key={id} href={`#${id}`}><span>0{i + 1}</span>{title}</a>)}</nav><div className={styles.sidebarNote}><PlugZap size={19} /><strong>One endpoint.<br />Your preferred AI client.</strong><p>Streamable HTTP<br />7 public, read-only tools</p></div><Link href="/"><a className={styles.backLink}>← Back to portfolio</a></Link></aside>
        <article className={styles.article}>
          <header className={styles.hero}>
            <div className={styles.eyebrow}><span /> INTEGRATION GUIDE</div>
            <h1>Connect your AI<br />to my portfolio.</h1>
            <p>Explore my projects, architecture, and technical writing through structured tools. Follow the setup below, then ask your AI client for answers backed by portfolio sources.</p>
            <div className={styles.badges}><span>Claude & Codex</span><span>Streamable HTTP</span><span>No API key for public access</span></div>
          </header>
          <div className={styles.endpointGrid}>
            <div><span className={styles.endpointLabel}><LockKeyhole size={13} /> ADMINISTRATORS ONLY</span><CopyBlock label="Admin endpoint">{ADMIN_URL}</CopyBlock><p>For authorized operators. Requires sign-in, consent, and a managed role.</p></div>
            <div><span className={styles.endpointLabel}>PUBLIC · NO SIGN-IN</span><CopyBlock label="Public endpoint">{PUBLIC_URL}</CopyBlock><p>For anyone exploring the portfolio. Read-only; no sign-in required.</p></div>
          </div>

          <section id="authorization" className={styles.section}>
            <SectionTitle number="01" title="Administrator access">A separate connection for authorized platform operators.</SectionTitle>
            <div className={styles.callout}><LockKeyhole size={20} /><p><strong>Browsing the portfolio does not require this step.</strong> Use <code>/mcp/admin</code> only if the site owner has assigned your account an administrator role. Signing in alone does not grant that role.</p></div>
            <ol className={styles.steps}>
              <li><strong>Add the protected endpoint.</strong> Create a separate connector named <b>Yuqi Portfolio Admin</b> with <code>{ADMIN_URL}</code>. Start its Connect or authentication action.</li>
              <li><strong>Sign in on yuqi.site.</strong> The client opens the authorization flow. Use your authorized administrator account or its Google sign-in. If you already have a valid session, the login step may be skipped.</li>
              <li><strong>Review the consent request.</strong> The “Connect an AI client” page identifies the client, requested permissions, and signed-in account. Choose <b>Allow access</b> only for the client you intended to connect, or <b>Deny</b> to cancel. Return to the client to review its available tools.</li>
            </ol>
            <div className={styles.authFigures}>
              <Figure number="01" file="admin-sign-in.png" alt="Yuqi site administrator sign-in page with email, password, and Google sign-in">The sign-in step in the authorization flow. It establishes your identity before client consent.</Figure>
              <Figure number="02" file="claude-admin-write-permissions.png" alt="Claude Portfolio Admin connector with Write/delete tools expanded, showing draft creation, content publishing, recovery workers, and RAG and search reindexing; all visible actions require approval">The expanded Write/delete tools list shows available administrative operations, including publishing and reindexing. Each visible action is set to Needs approval. Available tools depend on the server-managed role.</Figure>
            </div>
            <details className={styles.details}><summary>Authorize the administrator endpoint in Codex CLI</summary><CopyBlock label="Admin connection">{'codex mcp add yuqi-portfolio-admin --url https://www.yuqi.site/mcp/admin\ncodex mcp login yuqi-portfolio-admin'}</CopyBlock><p>Complete the browser sign-in and consent flow, then return to Codex. Do not copy access tokens into prompts or shared configuration files.</p></details>
            <p>OAuth establishes the connection; the server still checks your managed role on each request. Administrative operations are audited, and protected write workflows retain their confirmation requirements.</p>
          </section>

          <section id="connect" className={styles.section}>
            <SectionTitle number="02" title="Connect a client">Choose the setup that matches how you use AI.</SectionTitle>
            <h3>Claude · Add a custom connector</h3>
            <ol className={styles.steps}>
              <li><strong>Open Connectors.</strong> In Claude, open Settings → Customize → Connectors. If Settings points you to Customize, follow that link.</li>
              <li><strong>Add the server.</strong> Choose Add → Add custom connector, name it <b>Yuqi Portfolio</b>, and enter <code>{PUBLIC_URL}</code> as the remote MCP server URL.</li>
              <li><strong>Connect and review the tools.</strong> The public endpoint needs no API key or administrator account. Open the connector details to check that the seven read-only tools are available.</li>
            </ol>
            <p className={styles.note}>Custom connector availability depends on your Claude plan. If Add custom connector is unavailable, use the Codex setup below or another compatible MCP client.</p>
            <Figure number="03" file="claude-public-tools.png" alt="Claude showing Yuqi Portfolio connected to the public MCP endpoint with seven read-only tools">The public connector after setup. “Needs approval” is the client’s tool-use preference; it does not mean the public server requires a login.</Figure>

            <h3>Codex · Use the plugin or the MCP server</h3>
            <p>If the Yuqi Portfolio plugin is already installed, open <b>+ → Plugins → Yuqi Portfolio</b> in a task and ask Codex to use it. The plugin includes the MCP connection and portfolio-specific instructions.</p>
            <Figure number="04" file="codex-yuqi-portfolio-plugin-v2.png" alt="Yuqi Portfolio highlighted in the Codex Plugins menu">Select the installed plugin from the composer to make its purpose explicit in your task.</Figure>
            <p>For a direct server connection, run these commands in your terminal:</p>
            <CopyBlock label="Codex CLI">{'codex mcp add yuqi-portfolio --url https://www.yuqi.site/mcp\ncodex mcp list'}</CopyBlock>
            <p>Confirm that <code>yuqi-portfolio</code> appears in the list, then start a new task so Codex loads the tools.</p>
            <details className={styles.details}><summary>Install the complete Codex plugin from its marketplace</summary><CopyBlock label="Plugin installation">{'codex plugin marketplace add YuqiGuo105/portfolio-mcp-server\ncodex plugin add yuqi-portfolio@yuqi-portfolio-platform'}</CopyBlock><p>Start a new task after installation. Choose either the plugin or the direct server setup to avoid duplicate tool entries.</p></details>
            <p className={styles.resourceLink}>Using Claude Code, Cursor, VS Code, or Gemini CLI? <a href={`${SOURCE}/blob/main/docs/CLIENT_INTEGRATIONS.md`} target="_blank" rel="noreferrer">Open the client-specific configurations <ArrowUpRight size={14} /></a></p>
          </section>

          <section id="first-question" className={styles.section}>
            <SectionTitle number="03" title="Ask your first question">Make the connector, question, and evidence you want explicit.</SectionTitle>
            <CopyBlock label="Try this prompt">{'Use Yuqi Portfolio MCP to find projects that use Kafka.\nExplain one project’s architecture and link to the original source.'}</CopyBlock>
            <div className={styles.flow} aria-label="Example retrieval sequence"><div><span>SEARCH</span><code>search_projects</code><p>Find relevant projects.</p></div><span aria-hidden="true">→</span><div><span>RETRIEVE</span><code>get_project_architecture</code><p>Inspect a selected system.</p></div><span aria-hidden="true">→</span><div><span>ANSWER</span><strong>Evidence + source links</strong><p>Verify the explanation.</p></div></div>
            <p>Your client chooses the exact sequence. Review any tool-use approval prompt, then look for a tool result and portfolio source links in the answer. A response from general model knowledge alone does not confirm the connection.</p>
            <div className={styles.promptGrid}><div><h4>Engineering experience</h4><p>“Use Yuqi Portfolio MCP to summarize Yuqi’s backend experience and cite the public profile.”</p></div><div><h4>Technical writing</h4><p>“Find Yuqi’s articles about distributed systems. Summarize one and link to the article.”</p></div></div>
          </section>

          <section id="tools" className={styles.section}>
            <SectionTitle number="04" title="Seven public tools">Search first, then retrieve the evidence you need.</SectionTitle>
            <div className={styles.tableWrap}><table><thead><tr><th>Tool</th><th>When to use it</th></tr></thead><tbody>{tools.map(([name, purpose, detail]) => <tr key={name}><td><code>{name}</code></td><td><strong>{purpose}</strong><p>{detail}</p></td></tr>)}</tbody></table></div>
            <p className={styles.note}>Public responses exclude private operations, visitor identifiers, analytics, and audit records. The client discovers each tool’s input schema from the server; use returned project and article identifiers for follow-up calls.</p>
          </section>

          <section id="troubleshooting" className={styles.section}>
            <SectionTitle number="05" title="Troubleshooting" />
            <div className={styles.faq}>
              <details><summary>The MCP URL does not look like a webpage</summary><p><code>/mcp</code> is a protocol endpoint. Paste it into your client’s remote MCP server field. This guide at <code>/mcp-guide</code> is the page intended for people.</p></details>
              <details><summary>The connector is missing or no tools appear</summary><p>Check the exact URL and confirm that your client supports Streamable HTTP. Reopen the connector or start a new Codex task after setup. In the CLI, run <code>codex mcp list</code> to confirm the server is registered.</p></details>
              <details><summary>The administrator connection request expired</summary><p>Return to the AI client and start its connection or login flow again. Do not reuse an old consent URL: each request is tied to a specific authorization session.</p></details>
              <details><summary>I can sign in, but administrator access is denied</summary><p>Authentication and authorization are separate. The account must have an active server-managed administrator role. Contact the site owner if access is expected; use the public endpoint for portfolio questions.</p></details>
              <details><summary>The AI answers without using the connector</summary><p>Start a new task, enable the connector, and explicitly say “Use Yuqi Portfolio MCP.” Ask for source links and inspect the tool call. Availability of a connector does not mean every response uses it.</p></details>
            </div>
          </section>
          <footer className={styles.footer}><span>YUQI.SITE / MCP GUIDE</span><a href={`${SOURCE}/blob/main/docs/CLIENT_INTEGRATIONS.md`} target="_blank" rel="noreferrer">Configuration reference <ArrowUpRight size={14} /></a><p>Interface labels and available tools can change. Screenshots show the actual connected interfaces.</p></footer>
        </article>
      </div>
    </main>
  </>;
}
