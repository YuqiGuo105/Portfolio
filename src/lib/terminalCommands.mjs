// Commands for the site terminal (src/components/SiteTerminal.js). Pure: everything that touches the
// network, the router or the page arrives through `ctx`, so the commands are testable in Node.
// Output is a list of lines: { text, tone?, href? }. Text is always rendered as text, never HTML.
//
// Content comes from live sources only: the public MCP (projects, articles, profile), /api/metrics
// (services) and docs/architecture/platform-evolution.json (history). Nothing here restates it.

export const PROMPT_USER = 'visitor';
export const PROMPT_HOST = 'yuqi.site';

const line = (text = '', tone, href) => ({ text: String(text), ...(tone ? { tone } : {}), ...(href ? { href } : {}) });
// Column-aligned rows keep their spacing and scroll sideways on narrow screens.
const row = (text, tone) => ({ ...line(text, tone), pre: true });
const pad = (value, width) => {
  const text = String(value ?? '');
  return text.length >= width ? `${text.slice(0, width - 1)}… ` : text.padEnd(width + 1);
};

export const PAGES = Object.freeze({
  home: '/',
  globe: '/analytics',
  analytics: '/analytics',
  architecture: '/architecture',
  'time-machine': '/architecture#evolution',
  works: '/works',
  projects: '/works',
  blog: '/blogs',
  articles: '/blogs',
  cv: '/cv',
  resume: '/cv',
  mcp: '/mcp-guide',
  contact: '/#contact-section',
});

const MCP_TOOLS = ['search_portfolio', 'list_projects', 'list_articles', 'get_profile'];
const FILES = ['projects/', 'articles/', 'resume.txt', 'architecture.md', 'globe.app'];

// Split a command line into words; quotes group words ("kafka outbox").
export function tokenize(input) {
  const words = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(input || '')))) words.push(match[1] ?? match[2] ?? match[3]);
  return words;
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Swapped neighbours ("hlep") count as one typo.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

export function suggest(word, options) {
  let best = null; let score = Infinity;
  for (const option of options) {
    const d = distance(word, option);
    if (d < score) { score = d; best = option; }
  }
  return score <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

const errorText = (error) => ({
  rate_limited: 'mcp: too many calls — wait a minute and try again.',
  invalid_arguments: 'mcp: give a search term of 2–80 characters.',
  timeout: 'mcp: the MCP server took too long. It may be waking up — try again.',
  upstream_busy: 'mcp: the MCP server is busy. Try again shortly.',
  invalid_tool: 'mcp: that tool is not callable from here. Try: mcp tools',
}[error] || 'mcp: the MCP server is unavailable right now.');

async function tool(ctx, name, args) {
  const reply = await ctx.callTool(name, args);
  if (reply?.error) {
    const err = new Error(errorText(reply.error));
    err.terminal = true;
    throw err;
  }
  return reply;
}

function itemLines(items, empty) {
  if (!items?.length) return [line(empty, 'dim')];
  return items.flatMap((item) => [
    line(`  ${item.title}`, 'link', item.url),
    ...(item.tags?.length ? [line(`    ${item.tags.slice(0, 4).join(' · ')}`, 'dim')] : []),
  ]);
}

const json = (value) => JSON.stringify(value, null, 2).split('\n');

const COMMANDS = {
  help: {
    summary: 'list commands',
    run: () => [
      line('Commands', 'head'),
      ...Object.entries(COMMANDS).filter(([, c]) => !c.hidden)
        .map(([name, c]) => line(`  ${pad(name, 10)}${c.summary}`)),
      line(''),
      line('Try: ls projects · cat resume · mcp call search_portfolio kafka · kubectl get pods · git log', 'dim'),
      line('Tab completes, ↑/↓ walks history, Esc closes.', 'dim'),
    ],
  },
  ls: {
    summary: 'list projects/ or articles/',
    usage: ['projects', 'articles'],
    async run(ctx, [target = '']) {
      const dir = target.replace(/\/$/, '');
      if (!dir || dir === '~' || dir === '.') return [line(FILES.join('   '))];
      if (dir === 'projects') {
        const reply = await tool(ctx, 'list_projects');
        return [line(`${reply.result.items.length} projects (live from the MCP server)`, 'dim'), ...itemLines(reply.result.items, 'no projects')];
      }
      if (dir === 'articles') {
        const reply = await tool(ctx, 'list_articles');
        return [line(`${reply.result.items.length} articles (live from the MCP server)`, 'dim'), ...itemLines(reply.result.items, 'no articles')];
      }
      return [line(`ls: cannot access '${target}': No such file or directory`, 'err')];
    },
  },
  cat: {
    summary: 'read resume.txt or architecture.md',
    usage: ['resume.txt', 'architecture.md'],
    async run(ctx, [file = '']) {
      const name = file.replace(/^\.\//, '');
      if (name === 'resume.txt' || name === 'resume') {
        const { result } = await tool(ctx, 'get_profile');
        return [
          line('Experience', 'head'),
          ...result.experience.map((row) => line(`  ${pad(row.period, 22)}${row.title} @ ${row.company}`)),
          line(''),
          ...result.links.map((link) => line(`  ${pad(link.label, 10)}${link.url}`, 'link', link.url)),
          line(`  ${pad('Full CV', 10)}${result.cv}`, 'link', result.cv),
        ];
      }
      if (name === 'architecture.md') return [line('# Architecture → opening /architecture', 'dim'), ...ctx.open('/architecture')];
      if (name === 'globe.app') return [line('cat: globe.app: is an app — try `open globe`', 'err')];
      if (!name) return [line('usage: cat resume.txt', 'err')];
      return [line(`cat: ${file}: No such file or directory`, 'err')];
    },
  },
  open: {
    summary: 'open a page (globe, architecture, works, blog, cv, mcp)',
    usage: Object.keys(PAGES),
    run(ctx, [page = '']) {
      const path = PAGES[page.toLowerCase()];
      if (!path) {
        const guess = suggest(page.toLowerCase(), Object.keys(PAGES));
        return [line(`open: unknown page '${page}'.${guess ? ` Did you mean '${guess}'?` : ''} Pages: ${Object.keys(PAGES).join(', ')}`, 'err')];
      }
      return ctx.open(path);
    },
  },
  mcp: {
    summary: 'call the public MCP server: mcp tools · mcp call <tool> [query]',
    usage: ['tools', 'call'],
    async run(ctx, [sub = '', name = '', ...rest]) {
      if (sub === 'tools' || !sub) {
        return [
          line('Public MCP tools you can call from here (read-only):', 'head'),
          line('  search_portfolio <query>   list_projects   list_articles   get_profile'),
          line('Endpoint: https://www.yuqi.site/mcp — connect your own client at /mcp-guide', 'dim'),
        ];
      }
      if (sub !== 'call') return [line(`mcp: unknown subcommand '${sub}'. Try: mcp tools`, 'err')];
      if (!name) return [line('usage: mcp call search_portfolio kafka', 'err')];
      if (!MCP_TOOLS.includes(name)) {
        const guess = suggest(name, MCP_TOOLS);
        return [line(`mcp: unknown tool '${name}'.${guess ? ` Did you mean '${guess}'?` : ''} Try: mcp tools`, 'err')];
      }
      if (name === 'search_portfolio' && !rest.length) return [line('usage: mcp call search_portfolio <query>', 'err')];
      const args = name === 'search_portfolio' ? { query: rest.join(' ') } : {};
      const reply = await tool(ctx, name, args);
      return [
        line('→ request', 'head'),
        ...json(reply.request).map((text) => line(text, 'code')),
        line(`← result · ${reply.via === 'cache' ? `cached (live call took ${reply.elapsedMs} ms)` : `${reply.elapsedMs} ms`} · public fields only`, 'head'),
        ...json(reply.result).map((text) => line(text, 'code')),
      ];
    },
  },
  kubectl: {
    summary: 'kubectl get pods — the real backend services, live',
    usage: ['get'],
    async run(ctx, [verb = '', kind = '']) {
      if (verb !== 'get' || !/^(pods?|po|svc|services?)$/.test(kind)) {
        return [line('usage: kubectl get pods', 'err')];
      }
      const data = await ctx.fetchJson('/api/metrics');
      const services = Array.isArray(data?.services) ? data.services : [];
      if (!services.length) return [line('error: the monitoring backend did not answer. Try again in a moment.', 'err')];
      const age = (s) => {
        const v = Number(s.uptimeSeconds);
        if (!Number.isFinite(v) || v <= 0) return '-';
        return v >= 86400 ? `${Math.floor(v / 86400)}d` : v >= 3600 ? `${Math.floor(v / 3600)}h` : `${Math.max(1, Math.floor(v / 60))}m`;
      };
      const status = (s) => (s.up ? 'Running' : s.noMetrics ? 'ScaledToZero' : 'NotReady');
      return [
        row(`${pad('NAME', 34)}${pad('READY', 6)}${pad('STATUS', 13)}${pad('REQ/S', 7)}AGE`, 'head'),
        ...services.map((s) => row(
          `${pad(s.job, 34)}${pad(s.up ? '1/1' : '0/1', 6)}${pad(status(s), 13)}${pad(s.reqPerSec ?? 0, 7)}${age(s)}`,
          s.up ? undefined : s.noMetrics ? 'dim' : 'err',
        )),
        line(''),
        line('(Psst: these are Cloud Run services, not Kubernetes pods. Same idea, fewer YAML files.)', 'dim'),
      ];
    },
  },
  git: {
    summary: 'git log — how this platform evolved, with real commits',
    usage: ['log'],
    async run(ctx, [sub = '', ...flags]) {
      if (sub !== 'log') return [line(`git: '${sub}' is not available here. Try: git log`, 'err')];
      const all = flags.includes('--all') || flags.includes('-a');
      const milestones = await ctx.loadEvolution();
      const rows = [...milestones].reverse().slice(0, all ? milestones.length : 8);
      const out = rows.flatMap((m) => {
        const sha = m.evidence?.[0]?.sha || '0000000';
        const kind = m.type === 'incident' ? 'fix' : 'feat';
        return [
          line(`${sha}  ${m.date}  ${kind}: ${m.title}`, m.type === 'incident' ? 'warn' : undefined, `/architecture#evolution/${m.id}`),
        ];
      });
      if (!all && milestones.length > rows.length) out.push(line(`… ${milestones.length - rows.length} older — git log --all`, 'dim'));
      return out;
    },
  },
  whoami: {
    summary: 'who you are (roughly)',
    async run(ctx) {
      const me = await ctx.whereami();
      const where = me?.known ? [me.city, me.country].filter(Boolean).join(', ') : null;
      return [line(where ? `${PROMPT_USER} — browsing from around ${where}` : `${PROMPT_USER} — somewhere on Earth`),
        line('Plant a flag where you are: open globe', 'dim')];
    },
  },
  sudo: {
    summary: 'try it',
    async run(ctx, args) {
      if (args.join(' ').toLowerCase() === 'hire yuqi') {
        return [
          line(`[sudo] password for ${PROMPT_USER}: ********`, 'dim'),
          line('✔ Permission granted. Excellent judgement.', 'ok'),
          line('Opening the contact form…', 'dim'),
          ...ctx.open('/#contact-section'),
        ];
      }
      return [line(`${PROMPT_USER} is not in the sudoers file. This incident will be reported.`, 'err')];
    },
  },
  echo: { summary: 'print text', run: (_ctx, args) => [line(args.join(' '))] },
  date: { summary: 'current date', run: (ctx) => [line(ctx.now().toString())] },
  history: { summary: 'commands you ran', run: (ctx) => ctx.history().map((cmd, i) => line(`${String(i + 1).padStart(4)}  ${cmd}`)) },
  clear: { summary: 'clear the screen', run: (ctx) => { ctx.clear(); return []; } },
  exit: { summary: 'close the terminal', run: (ctx) => { ctx.close(); return []; } },
  cd: { hidden: true, run: (ctx, [dir = '']) => (PAGES[dir.replace(/\/$/, '')] ? ctx.open(PAGES[dir.replace(/\/$/, '')]) : [line('cd: there is only ~ here. Try: open <page>', 'dim')]) },
  pwd: { hidden: true, run: () => [line(`/home/${PROMPT_USER}`)] },
  rm: { hidden: true, run: () => [line('rm: nice try. This site is immutable (well, versioned).', 'warn')] },
  vim: { hidden: true, run: () => [line('You are now trapped in vim. Just kidding — type `exit` to leave the terminal.', 'dim')] },
  coffee: { hidden: true, run: () => [line('☕ Brewing… done. Back to work.', 'ok')] },
};

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMANDS));

export async function runCommand(input, ctx) {
  const words = tokenize(input);
  if (!words.length) return [];
  const [name, ...args] = words;
  const command = COMMANDS[name.toLowerCase()];
  if (!command) {
    const guess = suggest(name.toLowerCase(), COMMAND_NAMES.filter((c) => !COMMANDS[c].hidden));
    return [line(`command not found: ${name}${guess ? ` — did you mean '${guess}'?` : ''} (type help)`, 'err')];
  }
  try {
    return await command.run(ctx, args);
  } catch (error) {
    return [line(error?.terminal ? error.message : `${name}: something went wrong. Try again.`, 'err')];
  }
}

// Tab completion: the command, then its known first argument.
export function complete(input) {
  const words = tokenize(input);
  const trailing = /\s$/.test(input);
  if (words.length <= 1 && !trailing) {
    const prefix = (words[0] || '').toLowerCase();
    const hits = COMMAND_NAMES.filter((c) => !COMMANDS[c].hidden && c.startsWith(prefix));
    return hits.length === 1 ? `${hits[0]} ` : null;
  }
  const command = COMMANDS[words[0]?.toLowerCase()];
  if (!command?.usage) return null;
  const prefix = trailing ? '' : words[words.length - 1];
  const position = trailing ? words.length : words.length - 1;
  if (position !== 1) return null;
  const hits = command.usage.filter((u) => u.startsWith(prefix));
  return hits.length === 1 ? `${words[0]} ${hits[0]} ` : null;
}
