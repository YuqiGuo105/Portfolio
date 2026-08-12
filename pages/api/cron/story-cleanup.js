import { cleanupExpiredStories } from "../../../src/lib/storyStorage";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    return res.status(200).json({ ok: true, ...(await cleanupExpiredStories()) });
  } catch (error) {
    console.error("[Stories] cleanup failed", error);
    return res.status(500).json({ error: "cleanup_failed", message: error.message });
  }
}
