const metadata = {
  resource: "https://www.yuqi.site/mcp/admin",
  authorization_servers: [
    "https://iyvhmpdfrnznxgyvvkvx.supabase.co/auth/v1",
  ],
  scopes_supported: ["email", "profile"],
  bearer_methods_supported: ["header"],
  resource_documentation:
    "https://github.com/YuqiGuo105/portfolio-mcp-server/blob/main/docs/CLIENT_INTEGRATIONS.md",
};

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  return res.status(200).json(metadata);
}
