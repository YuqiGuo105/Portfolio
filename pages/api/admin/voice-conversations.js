import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { supabaseServer } from "../../../src/supabase/supabaseServer";
import { VOICE_CHANNELS, VOICE_MAX_MESSAGES, voiceHistoryOptions, voiceHistoryResponse } from "../../../src/lib/voice/historyView.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const options = voiceHistoryOptions(req.query);
  try {
    const { data, error } = await supabaseServer.from("conversation")
      .select("id,status,channel,created_at,updated_at,messages:message!conversation_id(id,conversation_id,role,content,metadata_json,created_at)")
      .in("channel", VOICE_CHANNELS)
      .gte("created_at", options.from)
      .lte("created_at", options.to)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(options.limit)
      .order("created_at", { referencedTable: "messages", ascending: true })
      .order("metadata_json->sequence", { referencedTable: "messages", ascending: true, nullsFirst: false })
      .order("id", { referencedTable: "messages", ascending: true })
      .limit(VOICE_MAX_MESSAGES, { referencedTable: "messages" })
      .abortSignal(AbortSignal.timeout(15000));
    if (error || !Array.isArray(data)) throw new Error("Voice history query failed");
    return res.status(200).json(voiceHistoryResponse(data, options));
  } catch {
    return res.status(503).json({
      error: "voice_history_unavailable",
      message: "Voice call history could not be loaded. Please retry.",
    });
  }
}
