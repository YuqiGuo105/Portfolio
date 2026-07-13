/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  async rewrites() {
    return [
      {
        source: '/mcp',
        destination: 'https://portfolio-mcp-server-702193211434.us-central1.run.app/mcp',
      },
    ];
  },
}

module.exports = nextConfig
