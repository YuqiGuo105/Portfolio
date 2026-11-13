import { NextResponse } from 'next/server';
import { shouldUseMcpBrowserLogin } from './src/lib/mcpBrowserEntry.mjs';
import { chooseHome, referralSource, VARIANTS } from './src/lib/discovery/core.mjs';

let homePolicy = {}, policyUntil = 0;

export async function middleware(request) {
  if (request.nextUrl.pathname === '/' && request.method === 'GET' && process.env.DISCOVERY_ENABLED === '1') {
    const privateVisit = request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1'
      || request.cookies.get('yuqi_analytics_optout') === '1';
    const bot = /bot|crawler|spider|headless/i.test(request.headers.get('user-agent') || '');
    if (!privateVisit && !bot) {
      let [source, variant] = (request.cookies.get('yuqi_home') || '').split('.');
      if (!['direct', 'linkedin', 'github'].includes(source) || !VARIANTS.includes(variant)) {
        source = referralSource(request.headers.get('referer') || '', request.nextUrl.searchParams.get('utm_source') || '');
        if (policyUntil < Date.now()) {
          // A cache-only policy lookup with a strict deadline; the default needs no network.
          try {
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 80);
            try {
              const response = await fetch(new URL('/api/discovery/home-policy', request.url), { signal: controller.signal });
              if (response.ok) homePolicy = (await response.json()).home || {};
            } finally { clearTimeout(timer); }
          } catch { /* Preserve the source-aware default. */ }
          policyUntil = Date.now() + 300000;
        }
        variant = chooseHome(source, homePolicy);
      }
      const destination = request.nextUrl.clone(); destination.pathname = `/home/${variant}`;
      const response = NextResponse.rewrite(destination);
      response.cookies.set('yuqi_home', `${source}.${variant}`, { maxAge: 1800, path: '/', sameSite: 'lax', secure: request.nextUrl.protocol === 'https:' });
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  }
  if (shouldUseMcpBrowserLogin({
    pathname: request.nextUrl.pathname,
    method: request.method,
    accept: request.headers.get('accept') || '',
  })) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/admin/login';
    destination.search = '';
    destination.searchParams.set('redirect', '/mcp/connect?access=admin');
    return NextResponse.redirect(destination, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/mcp/admin', '/'],
};
