const CHAT_PAGES = new Set([
  '/blogs', '/blog', '/works', '/works-list', '/work-single', '/blog-single',
  '/cv', '/analytics', '/site-history', '/404', '/architecture', '/mcp-guide',
  '/terminal', '/work-single/[id]', '/blog-single/[id]', '/life-blog/[id]',
]);
const LIVE_VOICE_PAGES = new Set([
  '/blogs', '/architecture', '/mcp-guide', '/terminal',
  '/work-single/[id]', '/blog-single/[id]', '/admin/mr-pot-voice',
]);

export function isHomePageRoute(pathname) {
  // Discovery rewrites the public home URL to this Next.js route for every source.
  return pathname === '/' || pathname === '/home/[variant]';
}

export function hasChatWidget(pathname) {
  return isHomePageRoute(pathname) || CHAT_PAGES.has(pathname);
}

export function hasLiveVoiceRoute(pathname) {
  return isHomePageRoute(pathname) || LIVE_VOICE_PAGES.has(pathname);
}
