export function shouldUseMcpBrowserLogin({ pathname = '', method = '', accept = '' } = {}) {
  return pathname === '/mcp/admin'
    && String(method).toUpperCase() === 'GET'
    && String(accept).toLowerCase().includes('text/html');
}
