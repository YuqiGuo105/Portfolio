// pages/llms.txt.js
// -----------------------------------------------------------------------------
// /llms.txt (https://llmstxt.org): a Markdown index that tells LLM agents what
// this site is, which pages matter, and how to query it through MCP instead of
// scraping HTML. Published projects and recent articles are listed live from
// Supabase; the static sections still render if that lookup fails.
// -----------------------------------------------------------------------------

import { supabaseServer } from '../src/supabase/supabaseServer';
import { SITE_URL } from '../src/components/SeoHead';

const oneLine = (value, max = 180) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const entry = (title, url, description) =>
  `- [${oneLine(title, 120)}](${url})${description ? `: ${oneLine(description)}` : ''}`;

export function buildLlmsTxt({ projects = [], articles = [] } = {}) {
  const lines = [
    '# Yuqi Guo — Software Engineer Portfolio',
    '',
    '> Portfolio of Yuqi Guo (郭育奇), a backend software engineer at Goldman Sachs working on distributed systems, event-driven microservices and AI agent platforms. The site itself runs on a production microservice platform (Next.js edge, Spring Boot services on Cloud Run, Kafka, PostgreSQL, OpenSearch, pgvector) and exposes its content over the Model Context Protocol.',
    '',
    'Prefer the MCP endpoint below for structured, citable answers; the HTML pages are written for people.',
    '',
    '## Key pages',
    entry('Home', `${SITE_URL}/`, 'Profile, experience, featured projects and live platform dashboards'),
    entry('Projects', `${SITE_URL}/works-list`, 'Project archive with architecture write-ups'),
    entry('System design', `${SITE_URL}/architecture`, 'Container diagram, UML data flows and the design patterns used by the platform'),
    entry('Résumé', `${SITE_URL}/cv`, 'Education and work history'),
    entry('Blog', `${SITE_URL}/blogs`, 'Engineering write-ups and life notes'),
    entry('RSS feed', `${SITE_URL}/rss.xml`, 'Latest articles'),
    '',
    '## MCP access',
    `- Public endpoint: ${SITE_URL}/mcp (Streamable HTTP, read-only, rate-limited). Tools include search_portfolio, get_overview, get_profile, list_projects, get_project, get_project_architecture, list_articles, get_article and match_role.`,
    entry('MCP connection guide', `${SITE_URL}/mcp-guide`, 'How to connect Claude, Codex or any MCP client'),
    '',
  ];

  if (projects.length) {
    lines.push('## Projects');
    for (const project of projects) lines.push(entry(project.title, `${SITE_URL}/work-single/${project.id}`, project.summary));
    lines.push('');
  }

  if (articles.length) {
    lines.push('## Recent articles');
    for (const article of articles) lines.push(entry(article.title, `${SITE_URL}/blog-single/${article.id}`, article.description));
    lines.push('');
  }

  lines.push('## Optional');
  lines.push(entry('Source code', 'https://github.com/YuqiGuo105/Portfolio', 'Next.js application, architecture diagrams and MCP integration'));
  lines.push(entry('Privacy', `${SITE_URL}/privacy`, 'What the site collects and why'));
  lines.push('');
  return lines.join('\n');
}

export async function getServerSideProps({ res }) {
  let projects = [];
  let articles = [];
  try {
    const [projectsRes, articlesRes] = await Promise.all([
      supabaseServer
        .from('Projects')
        .select('id,title,summary,num')
        .eq('publication_status', 'PUBLISHED')
        .order('num', { ascending: false })
        .limit(20),
      supabaseServer
        .from('Blogs')
        .select('id,title,description,date')
        .order('date', { ascending: false })
        .limit(15),
    ]);
    if (!projectsRes.error && Array.isArray(projectsRes.data)) projects = projectsRes.data.filter((row) => row.title);
    if (!articlesRes.error && Array.isArray(articlesRes.data)) articles = articlesRes.data.filter((row) => row.title);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[llms.txt] supabase enumeration failed:', error && error.message);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.write(buildLlmsTxt({ projects, articles }));
  res.end();
  return { props: {} };
}

// Never rendered — getServerSideProps writes the response directly.
export default function LlmsTxt() {
  return null;
}
