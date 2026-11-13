export const VERSION = 'discovery-v1';
export const VARIANTS = ['original', 'career', 'engineering'];
export const SECTION_ORDER = {
  original: ['home-intro', 'about-section', 'resume-section', 'works-section', 'Blog-section'],
  career: ['home-intro', 'resume-section', 'works-section', 'about-section', 'Blog-section'],
  engineering: ['home-intro', 'works-section', 'Blog-section', 'resume-section', 'about-section'],
};

export function referralSource(referrer = '', source = '') {
  if (['linkedin', 'github'].includes(source.toLowerCase())) return source.toLowerCase();
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in') return 'linkedin';
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  } catch { /* Direct visits have no referrer. */ }
  return 'direct';
}

export function chooseHome(source, stats = {}, random = Math.random) {
  const preferred = { linkedin: 'career', github: 'engineering' }[source] || 'original';
  const rows = VARIANTS.map(variant => ({ variant, ...(stats[`${source}:${variant}`] || {}) }));
  const mature = rows.every(row => row.views >= 30);
  // Cold start preserves the referral-aware default; exploration is session-stable in the cookie.
  const best = mature ? rows.sort((a, b) => ((b.clicks || 0) + 1) / (b.views + 2) - ((a.clicks || 0) + 1) / (a.views + 2))[0].variant : preferred;
  return random() < .1 ? VARIANTS[Math.min(2, Math.floor(random() * 3))] : best;
}

export function tokens(text) {
  return String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}+#.-]+/gu) || [];
}

export function lexical(query, items) {
  const words = [...new Set(tokens(query))];
  return items.map(item => {
    const title = item.title.toLowerCase(), haystack = `${item.title} ${item.tags} ${item.text || item.description}`.toLowerCase();
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 4 : haystack.includes(word) ? 1 : 0), 0);
    return { item, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

export function hybrid(query, items, vectors = {}, queryVector = null) {
  const score = new Map();
  const add = rows => rows.forEach((row, index) => score.set(row.item.id, (score.get(row.item.id) || 0) + 1 / (60 + index + 1)));
  add(lexical(query, items));
  if (queryVector) add(items.map(item => ({ item, score: cosine(vectors[item.id], queryVector) }))
    .filter(row => row.score > .25).sort((a, b) => b.score - a.score).slice(0, 20));
  return items.filter(item => score.has(item.id)).sort((a, b) => score.get(b.id) - score.get(a.id) || a.id.localeCompare(b.id));
}

export function recommend(current, items, vectors = {}, pairs = {}) {
  const topical = new Map(lexical(`${current.title} ${current.tags}`, items).map(row => [row.item.id, row.score]));
  const ranked = items.filter(item => item.id !== current.id).map(item => {
    const related = cosine(vectors[current.id], vectors[item.id]);
    const count = pairs[[current.id, item.id].sort().join('|')] || 0;
    // Only aggregated pairs observed in >= 3 sessions influence ranking.
    const score = (related > 0 ? related : Math.min(1, (topical.get(item.id) || 0) / 20)) + (count >= 3 ? Math.min(.25, Math.log1p(count) / 20) : 0);
    return { item, score, reason: count >= 3 ? 'Also explored' : 'Related topic' };
  }).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return ranked.slice(0, 3).map(({ item, reason }) => ({ id: item.id, reason }));
}

// Only vocabulary already present in public content can become a shared suggestion.
export function safeQuery(query, items) {
  const text = String(query).normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 64 || /[@:/\\]|\d{4}/.test(text)) return null;
  const words = tokens(text);
  const vocabulary = new Set(items.flatMap(item => tokens(`${item.title} ${item.tags}`)));
  return words.length > 0 && words.length <= 6 && words.every(word => vocabulary.has(word)) ? text : null;
}

export function suggestions(prefix, items, counts = {}) {
  const q = String(prefix).normalize('NFKC').toLowerCase().trim();
  if (q.length < 2 || q.length > 80) return [];
  const learned = Object.entries(counts).filter(([text, n]) => n >= 5 && text.startsWith(q) && safeQuery(text, items))
    .sort((a, b) => b[1] - a[1]).map(([text]) => ({ text, kind: 'query' }));
  const titles = items.filter(item => item.title.toLowerCase().includes(q) || tokens(item.tags).some(word => word.startsWith(q)))
    .map(item => ({ text: item.title, id: item.id, url: item.url, kind: item.type, image: item.image }));
  return [...learned, ...titles].filter((row, i, all) => all.findIndex(other => other.text === row.text) === i).slice(0, 6);
}

export function searchRow(item, index) {
  return { id: item.id, source: item.type === 'project' ? 'Projects' : 'Blog', sourceId: item.contentId,
    sourceTable: item.type === 'project' ? 'Projects' : 'Blogs', title: item.title, description: item.description,
    url: item.url, tags: item.tags, sourceRequiresLogin: false, rank: index + 1 };
}

export function orderedProjects(projects, systems, variant) {
  if (variant !== 'engineering') return projects;
  return [...projects].sort((a, b) => Number(Boolean(systems[b.id]?.diagram_config)) - Number(Boolean(systems[a.id]?.diagram_config)));
}
