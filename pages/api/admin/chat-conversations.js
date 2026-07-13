import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { listAgentConversations } from "../../../src/lib/adminOpenSearch";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  try {
    const result = await listAgentConversations({
      query: req.query.q,
      hours: req.query.hours,
      limit: req.query.limit,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("[admin conversations]", error);
    res.status(502).json({
      error: "observability_unavailable",
      message: "Conversation activity is temporarily unavailable.",
    });
  }
}
