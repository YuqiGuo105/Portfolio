import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  await forward(req, res, { path: "/api/health/notification", method: "GET" });
}
