import { forwardJson, requireAdminUser } from "../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  await forwardJson(req, res, {
    path: "/api/admin/cost-guardrail",
    method: "GET",
    auth,
  });
}
