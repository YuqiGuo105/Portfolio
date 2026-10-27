import { requireAdmin } from "../../../src/lib/adminRouteAuth";
import { supabaseFlagStore } from "../../../src/lib/globeFlags.mjs";
import { supabaseServer } from "../../../src/supabase/supabaseServer";

const STATUSES = new Set(["pending", "approved", "rejected"]);
const ACTIONS = new Set(["approve", "reject", "delete"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = { api: { bodyParser: { sizeLimit: "2kb" } } };

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  res.setHeader("Cache-Control", "no-store");
  const store = supabaseFlagStore(supabaseServer);
  try {
    if (req.method === "GET") {
      const status = STATUSES.has(req.query.status) ? req.query.status : "pending";
      const flags = await store.listForReview(status);
      if (flags === null) return res.status(200).json({ enabled: false, flags: [] });
      return res.status(200).json({ enabled: true, flags });
    }
    if (req.method === "POST") {
      const { id, action } = req.body || {};
      if (!UUID.test(String(id || "")) || !ACTIONS.has(action)) {
        return res.status(400).json({ error: "invalid_request", message: "A flag id and approve, reject or delete are required." });
      }
      return res.status(200).json(await store.review(id, action));
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[globe-flags] admin operation failed", error?.message || error);
    return res.status(500).json({ error: "globe_flags_failed", message: "Globe flags could not be updated." });
  }
}
