const CHAT_PAGES = new Set([
  '/blogs', '/blog', '/works', '/works-list', '/work-single', '/blog-single',
  '/cv', '/analytics', '/site-history', '/404', '/architecture', '/mcp-guide',
  '/terminal', '/work-single/[id]', '/blog-single/[id]', '/life-blog/[id]',
]);

export function isHomePageRoute(pathname) {
  // Discovery rewrites the public home URL to this Next.js route for every source.
  return pathname === '/' || pathname === '/home/[variant]';
}

export function hasChatWidget(pathname) {
  return isHomePageRoute(pathname) || CHAT_PAGES.has(pathname);
}
