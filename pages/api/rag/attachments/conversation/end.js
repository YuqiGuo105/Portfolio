import {
  forwardJson,
  methodGuard,
  requireSupabaseUser,
} from "../../../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;
  await forwardJson(req, res, {
    path: "/api/rag/attachments/conversation/end",
    method: "POST",
    auth,
  });
}
