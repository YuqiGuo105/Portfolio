import { listStories } from "../../src/lib/storyStorage";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const stories = await listStories();
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ stories });
  } catch (error) {
    console.error("[Stories] public list failed", error);
    return res.status(503).json({ error: "stories_unavailable", stories: [] });
  }
}
