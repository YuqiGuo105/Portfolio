import { forwardJson, requireAdminUser } from "../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  const params = new URLSearchParams({
    q: String(req.query.q || ""),
    hours: String(req.query.hours || "168"),
    limit: String(req.query.limit || "50"),
  });
  await forwardJson(req, res, {
    path: `/api/admin/conversations?${params.toString()}`,
    method: "GET",
    auth,
  });
}
