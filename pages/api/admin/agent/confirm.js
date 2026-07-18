import {
  forwardJson,
  methodGuard,
  requireAdminUser,
} from "../../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  await forwardJson(req, res, {
    path: "/api/intent/confirm",
    method: "POST",
    auth,
  });
}
