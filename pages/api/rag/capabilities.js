import { forwardJson, methodGuard, requireSupabaseUser } from "../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;
  await forwardJson(req, res, { path: "/api/chat/capabilities", method: "GET", auth, timeoutMs: 10000 });
}
