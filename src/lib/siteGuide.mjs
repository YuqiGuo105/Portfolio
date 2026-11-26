// The public map of the site: the sections a visitor can be taken to, what each one shows and
// the anchor it lives at. This is the one list. The web guide's targets, the voice call's
// destinations and GET /api/site/guide are all read from it, and the public MCP tool
// `get_site_guide` serves that endpoint to AI clients, the voice relay among them.
//
// Adding a section here does not let anything navigate to a new place by itself: every consumer
// only ever follows an anchor from this file, never a link it was handed.
export const SITE_ORIGIN = 'https://www.yuqi.site';

export const SITE_SECTIONS = Object.freeze([
  { key: 'home.about', route: '/', targetId: 'tour-about', label: 'About',
    covers: 'Who Yuqi is: his role, what he works on and a short introduction.',
    topics: ['about', 'introduction', 'who is yuqi', 'summary', 'role', '关于', '介绍', '简介'] },
  { key: 'home.background', route: '/', targetId: 'tour-background', label: 'My Background',
    covers: 'Education and work history: degrees, universities, employers and dates.',
    topics: ['education', 'degree', 'university', 'school', 'work history', 'experience', 'career', 'employer', '学历', '教育', '学校', '大学', '学位', '工作经历', '履历'] },
  { key: 'home.projects', route: '/', targetId: 'tour-projects', label: 'Projects',
    covers: 'Selected projects with their stack, each linking to its case study.',
    topics: ['projects', 'portfolio', 'case study', 'open source', 'what he built', '项目', '作品', '开源'] },
  { key: 'home.techBlogs', route: '/', targetId: 'tour-techblogs', label: 'My Blogs',
    covers: 'Technical articles and engineering write-ups.',
    topics: ['blog', 'articles', 'writing', 'posts', '博客', '文章', '技术文章'] },
  { key: 'home.lifeBlogs', route: '/', targetId: 'tour-life', label: 'Life Blogs',
    covers: 'Travel, photography and life outside code.',
    topics: ['life', 'travel', 'hobbies', 'photography', '生活', '旅行', '爱好'] },
  { key: 'home.dashboard', route: '/', targetId: 'tour-real-time-data', label: 'Real Time Data',
    covers: 'The live visitor globe and the monitoring of the services behind the site.',
    topics: ['visitors', 'globe', 'analytics', 'monitoring', 'live data', 'traffic', '访客', '地球', '监控', '实时数据'] },
  { key: 'home.contact', route: '/', targetId: 'tour-contact', label: 'Contact',
    covers: 'How to reach Yuqi: a message, a live chat or a referral request.',
    topics: ['contact', 'email', 'message', 'reach', 'hire', 'referral', '联系', '联系方式', '内推'] },
].map(section => Object.freeze({ ...section, href: `${section.route}#${section.targetId}`, topics: Object.freeze(section.topics) })));

const byKey = new Map(SITE_SECTIONS.map(section => [section.key, section]));
export const siteSection = key => byKey.get(key) || null;

// What GET /api/site/guide answers with. Public text and public links only.
export function publicSiteGuide() {
  return {
    schemaVersion: 1,
    sections: SITE_SECTIONS.map(({ key, label, covers, topics, href }) => ({ key, label, covers, topics: [...topics], url: `${SITE_ORIGIN}${href}` })),
  };
}

const text = (value, limit) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');

// A guide that came back over the network (the MCP tool's result) is reference data. Only its
// wording is taken, for sections this file already knows; where a section points is never taken
// from it. A section the answer no longer lists is no longer offered.
export function trustedSiteGuide(remote) {
  const rows = Array.isArray(remote?.sections) ? remote.sections.slice(0, 24) : null;
  if (!rows) return null;
  const sections = [];
  for (const row of rows) {
    const known = siteSection(row?.key);
    if (!known || sections.some(section => section.key === known.key)) continue;
    sections.push({ ...known, label: known.label, covers: text(row.covers, 240) || known.covers });
  }
  return sections.length ? sections : null;
}
