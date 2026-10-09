import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  if (!/^v1\.[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: "invalid_link" });
  }
  // Mail scanners following a GET must never unsubscribe the recipient.
  if (req.method === "GET") return res.redirect(303, `/subscriptions/unsubscribe#token=${token}`);
  const body = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
  if (body?.["List-Unsubscribe"] !== "One-Click") return res.status(400).json({ error: "invalid_request" });
  return forward({ ...req, body: { token } }, res, {
    path: "/api/subscriptions/unsubscribe", method: "POST", forwardQuery: false,
  });
}
