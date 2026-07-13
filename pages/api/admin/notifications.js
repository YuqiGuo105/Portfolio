import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  await forward(req, res, { path: "/api/admin/notifications", method: "GET" });
}
