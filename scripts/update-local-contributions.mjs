import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = '0470298d-c74d-4d4b-be33-d948b033002a';
const groups = [
  { name: 'RxJava', repo: 'ReactiveX/RxJava', prs: [8399], summary: 'Isolated the Flowable observeOn race test for parallel test execution. Test-only change; production behavior is unchanged.' },
  { name: 'Google ADK Java', repo: 'google/adk-java', prs: [1381, 923], summary: 'Exposed live-turn completion controls and cleaned up empty parent maps when deleting in-memory sessions.' },
  { name: 'Kubernetes Java Client', repo: 'kubernetes-client/java', prs: [4868, 4751, 4746], summary: 'Added a tested custom-object PATCH example, local CRD generator builds, and opt-in managedFields deserialization.' },
  { name: 'Spring AI Alibaba', repo: 'alibaba/spring-ai-alibaba', prs: [4491], summary: 'Preserved shell sessions across human-in-the-loop interrupt and resume.' },
  { name: 'Google LangExtract', repo: 'google/langextract', prs: [385], summary: 'Added bounded retries for transient Gemini errors during document extraction.' },
];
const verified = [];
for (const group of groups) {
  for (const number of group.prs) {
    const response = await fetch(`https://api.github.com/repos/${group.repo}/pulls/${number}`);
    if (!response.ok) throw new Error(`GitHub verification failed: ${response.status}`);
    const pr = await response.json();
    if (!pr.merged || pr.user.login !== 'YuqiGuo105') throw new Error(`Unverified contribution: ${group.repo}#${number}`);
    verified.push({ repo: group.repo, number, title: pr.title, url: pr.html_url, mergedAt: pr.merged_at });
  }
}
const response = await fetch(`http://127.0.0.1:3154/work-single/${id}`);
const page = new JSDOM(await response.text()).window.document;
const project = JSON.parse(page.querySelector('#__NEXT_DATA__').textContent).props.pageProps.project;
const draftPath = path.join(root, 'docs/content-drafts', `${id}.json`);
let previousDraft;
try { previousDraft = JSON.parse(await fs.readFile(draftPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const baseContent = previousDraft?.sourceUpdatedAt === project.updatedAt ? previousDraft.content : project.content;
const doc = new JSDOM(baseContent).window.document;
doc.querySelector('.project-eyebrow').textContent = `Open Source / ${verified.length} Merged Pull Requests / ${groups.length} Upstream Projects / 2026`;
doc.querySelector('.project-hero h2').textContent = 'Contributions to RxJava, Google ADK, Kubernetes and AI Libraries';
doc.querySelector('.project-summary').textContent = 'Eight merged pull requests across five upstream projects, covering agent lifecycle, streaming turns, retry behavior, Kubernetes tooling and test isolation.';
const table = doc.querySelector('#os-summary + table');
table.innerHTML = '<thead><tr><th>Project</th><th>Contribution</th><th>Merged pull requests</th></tr></thead><tbody></tbody>';
for (const group of groups) {
  const row = doc.createElement('tr');
  const name = doc.createElement('td'); name.textContent = group.name;
  const summary = doc.createElement('td'); summary.textContent = group.summary;
  const links = doc.createElement('td');
  group.prs.forEach((number, index) => {
    if (index) links.append(', ');
    const a = doc.createElement('a'); a.href = `https://github.com/${group.repo}/pull/${number}`; a.textContent = `#${number}`; links.append(a);
  });
  row.append(name, summary, links); table.querySelector('tbody').append(row);
}
// Keep the original case studies and Wiki links; add the newly covered work once.
doc.querySelector('#os-new-contributions')?.remove();
const latest = doc.createElement('section'); latest.id = 'os-new-contributions';
latest.innerHTML = '<h2>Further Merged Contributions</h2>';
for (const group of groups.slice(0, 3)) {
  const h3 = doc.createElement('h3'); h3.textContent = group.name;
  const p = doc.createElement('p'); p.textContent = group.summary;
  latest.append(h3, p);
}
doc.querySelector('#os-takeaways').before(latest);
doc.querySelector('#os-takeaways + ul').innerHTML = '<li><strong>Keep changes focused.</strong> Repair lifecycle and integration boundaries without unrelated refactoring.</li><li><strong>Make behavior verifiable.</strong> Add regression tests or isolate concurrency tests, with the scope documented in each PR.</li><li><strong>Upstream evidence.</strong> Every linked contribution is merged; the PR pages retain the review and implementation history.</li>';
const tags = doc.querySelector('.project-tags'); tags.replaceChildren();
verified.forEach((pr, index) => {
  if (index) tags.append(' / ');
  const a = doc.createElement('a'); a.href = pr.url; a.textContent = `${pr.repo} #${pr.number}`; tags.append(a);
});
const dir = path.join(root, 'docs/content-drafts'); await fs.mkdir(dir, { recursive: true });
// The article renderer expects raw Mermaid text, not a second HTML-entity layer.
const diagrams = [...doc.querySelectorAll('div.mermaid')].map((node, index) => {
  const decoder = doc.createElement('textarea');
  decoder.innerHTML = node.innerHTML;
  const code = decoder.value;
  node.replaceWith(doc.createComment(`local-mermaid-${index}`));
  return code;
});
let content = doc.body.innerHTML;
diagrams.forEach((code, index) => { content = content.replace(`<!--local-mermaid-${index}-->`, () => `<div class="mermaid">${code}</div>`); });
await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({
  id, verifiedAt: new Date().toISOString(), sourceUpdatedAt: project.updatedAt,
  summary: doc.querySelector('.project-summary').textContent,
  technology: 'Open Source, Java, AI Agents, RxJava, Google ADK, Spring AI Alibaba, Google LangExtract, Kubernetes, Testing',
  content, contributions: verified,
}, null, 2) + '\n');
console.log(`Local draft: ${verified.length} verified merged PRs, ${groups.length} projects. Production unchanged.`);
