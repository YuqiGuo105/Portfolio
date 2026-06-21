import { forward, methodGuard } from "../../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["PATCH"])) return;
  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: "missing_id" });
    return;
  }
  await forward(req, res, {
    path: `/api/notifications/${encodeURIComponent(String(id))}/read`,
    method: "PATCH",
    forwardQuery: false,
  });
}
