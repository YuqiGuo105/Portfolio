import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";
export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST", "DELETE"])) return;
  await forward(req, res, { path: "/api/push/subscriptions", method: req.method, forwardQuery: false });
}
