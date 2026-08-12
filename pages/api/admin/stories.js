import { requireAdmin } from "../../../src/lib/adminRouteAuth";
import {
  deleteStory,
  finalizeStory,
  listStories,
  prepareStoryUpload,
  storyStorageConfig,
} from "../../../src/lib/storyStorage";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  try {
    if (req.method === "GET") {
      return res.status(200).json({ stories: await listStories(), config: storyStorageConfig() });
    }
    if (req.method === "POST") {
      const operation = req.body?.operation;
      if (operation === "prepare-upload") {
        return res.status(200).json(await prepareStoryUpload(req.body));
      }
      if (operation === "finalize") {
        const story = await finalizeStory({ ...req.body, actor: user.email });
        return res.status(201).json({ story });
      }
      return res.status(400).json({ error: "invalid_operation", message: "Unknown story operation." });
    }
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!id) return res.status(400).json({ error: "missing_id", message: "Story ID is required." });
      await deleteStory(id);
      return res.status(200).json({ deleted: true, id });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[Stories] admin operation failed", error);
    return res.status(error.status || 500).json({ error: "story_operation_failed", message: error.message || "Story operation failed." });
  }
}
