import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shouldUseMcpBrowserLogin } from '../src/lib/mcpBrowserEntry.mjs';

const page = fs.readFileSync(new URL('../pages/mcp/connect.js', import.meta.url), 'utf8');
const middleware = fs.readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');

test('browser navigation starts at the administrator login page', () => {
  assert.equal(shouldUseMcpBrowserLogin({
    pathname: '/mcp/admin',
    method: 'GET',
    accept: 'text/html,application/xhtml+xml',
  }), true);
  assert.match(middleware, /destination\.pathname = '\/admin\/login'/);
  assert.match(middleware, /destination\.searchParams\.set\('redirect', '\/mcp\/connect\?access=admin'\)/);
  assert.match(middleware, /NextResponse\.redirect\(destination, 307\)/);
});

test('MCP protocol traffic is never redirected to the browser guide', () => {
  for (const request of [
    { pathname: '/mcp/admin', method: 'POST', accept: 'application/json' },
    { pathname: '/mcp/admin', method: 'GET', accept: 'text/event-stream' },
    { pathname: '/mcp/admin', method: 'GET', accept: 'application/json' },
    { pathname: '/mcp', method: 'GET', accept: 'text/html' },
  ]) {
    assert.equal(shouldUseMcpBrowserLogin(request), false, JSON.stringify(request));
  }
});

test('connection guide separates public and protected access', () => {
  assert.match(page, /Public MCP/);
  assert.match(page, /No sign-in required/);
  assert.match(page, /Admin MCP/);
  assert.match(page, /OAuth and managed role required/);
  assert.match(page, /No API key needs to be created or pasted into chat/);
  assert.match(page, /Browser sign-in only/);
  assert.match(page, /Never create, copy, or paste an API token into an AI chat/);
  assert.match(page, /Open secure sign-in/);
});
