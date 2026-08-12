import { supabaseServer } from "../supabase/supabaseServer";

export async function requireAdmin(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "unauthenticated", message: "Admin session token is required." });
    return null;
  }
  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user?.email) {
    res.status(401).json({ error: "invalid_session", message: "Admin session is invalid or expired." });
    return null;
  }
  const allowed = String(process.env.ADMIN_ALLOWED_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length || !allowed.includes(data.user.email.toLowerCase())) {
    res.status(403).json({ error: "access_denied", message: "This account is not an authorized administrator." });
    return null;
  }
  return data.user;
}
