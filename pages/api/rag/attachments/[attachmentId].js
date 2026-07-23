import {
  forwardJson,
  methodGuard,
  requireSupabaseUser,
} from "../../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["DELETE"])) return;
  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;
  const attachmentId = encodeURIComponent(String(req.query.attachmentId || ""));
  const sessionId = encodeURIComponent(String(req.query.sessionId || ""));
  await forwardJson(req, res, {
    path: `/api/rag/attachments/${attachmentId}?sessionId=${sessionId}`,
    method: "DELETE",
    auth,
  });
}
