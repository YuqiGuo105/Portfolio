/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  async rewrites() {
    const mcpBase = process.env.MCP_SERVER_URL || 'https://portfolio-mcp-server-702193211434.us-central1.run.app';
    return [
      {
        source: '/mcp',
        destination: `${mcpBase}/mcp`,
      },
      {
        source: '/mcp/admin',
        destination: `${mcpBase}/mcp/admin`,
      },
    ];
  },
}

module.exports = nextConfig
