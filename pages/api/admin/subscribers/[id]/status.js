import { requireAdminUser } from "../../../../../src/lib/agentServiceProxy";
import { forward, methodGuard } from "../../../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["PATCH"])) return;
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ error: "invalid_subscriber_id" });
    return;
  }
  await forward(req, res, {
    path: `/api/admin/subscribers/${encodeURIComponent(id)}/status`,
    method: "PATCH",
    forwardQuery: false,
  });
}
