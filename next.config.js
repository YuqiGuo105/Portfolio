/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },

  async rewrites() {
    const mcpBase = process.env.MCP_SERVER_URL || "https://portfolio-mcp-server-702193211434.us-central1.run.app";
    return [
      {
        source: "/mcp",
        destination: `${mcpBase}/mcp`,
      },
      {
        source: "/mcp/admin",
        destination: `${mcpBase}/mcp/admin`,
      },
    ];
  },

  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/assets/audio/tour/v1/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },

}

module.exports = nextConfig
