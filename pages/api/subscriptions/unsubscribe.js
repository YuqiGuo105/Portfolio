import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  await forward(req, res, { path: "/api/subscriptions/unsubscribe", method: "POST" });
}
