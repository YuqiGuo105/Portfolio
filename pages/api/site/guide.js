import { publicSiteGuide } from "../../../src/lib/siteGuide.mjs";

// The public map of the site's sections. The public MCP tool `get_site_guide` reads it, so that an
// AI client (the voice call among them) can tell a visitor where something is, or take them there.
const guide = publicSiteGuide();
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json(guide);
}
