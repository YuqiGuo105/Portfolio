import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shouldRenderMcpConnect } from '../src/lib/mcpBrowserEntry.mjs';

const page = fs.readFileSync(new URL('../pages/mcp/connect.js', import.meta.url), 'utf8');
const middleware = fs.readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');

test('browser navigation renders the MCP connection guide', () => {
  assert.equal(shouldRenderMcpConnect({
    pathname: '/mcp/admin',
    method: 'GET',
    accept: 'text/html,application/xhtml+xml',
  }), true);
  assert.match(middleware, /destination\.pathname = '\/mcp\/connect'/);
  assert.match(middleware, /destination\.search = '\?access=admin'/);
});

test('MCP protocol traffic is never redirected to the browser guide', () => {
  for (const request of [
    { pathname: '/mcp/admin', method: 'POST', accept: 'application/json' },
    { pathname: '/mcp/admin', method: 'GET', accept: 'text/event-stream' },
    { pathname: '/mcp/admin', method: 'GET', accept: 'application/json' },
    { pathname: '/mcp', method: 'GET', accept: 'text/html' },
  ]) {
    assert.equal(shouldRenderMcpConnect(request), false, JSON.stringify(request));
  }
});

test('connection guide separates public and protected access', () => {
  assert.match(page, /Public MCP/);
  assert.match(page, /No sign-in required/);
  assert.match(page, /Admin MCP/);
  assert.match(page, /OAuth and managed role required/);
  assert.match(page, /No API key needs to be created or pasted into chat/);
  assert.match(page, /Sign in to verify access/);
  assert.match(page, /Authorization begins inside your AI client/);
});
