import { NextResponse } from 'next/server';
import { shouldUseMcpBrowserLogin } from './src/lib/mcpBrowserEntry.mjs';

export function middleware(request) {
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
  matcher: ['/mcp/admin'],
};
