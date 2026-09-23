import { NextResponse } from 'next/server';
import { shouldRenderMcpConnect } from './src/lib/mcpBrowserEntry.mjs';

export function middleware(request) {
  if (shouldRenderMcpConnect({
    pathname: request.nextUrl.pathname,
    method: request.method,
    accept: request.headers.get('accept') || '',
  })) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/mcp/connect';
    destination.search = '?access=admin';
    return NextResponse.rewrite(destination);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/mcp/admin'],
};
