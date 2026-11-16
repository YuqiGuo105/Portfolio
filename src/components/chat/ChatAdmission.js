import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// How the chat window takes part in the waiting line (src/lib/chat/admission.mjs): it asks for a
// place when it opens, keeps checking in while it waits, and tells the visitor where they stand.
const CHECK_EVERY = { queued: 6000, full: 60000 };
const HOLDS_PLACE = ["active", "off", "unknown"]; // "unknown": the line could not be asked, so it is not in the way

export function useChatAdmission(deviceId) {
  const [admission, setAdmission] = useState({ status: "checking" });
  const latest = useRef(admission);
  latest.current = admission;

  const ask = useCallback(async (action = "enter") => {
    try {
      const response = await fetch("/api/rag/admission", {
        method: "POST", keepalive: action === "leave",
        headers: { "Content-Type": "application/json", ...(deviceId ? { "X-CW-Device-Id": deviceId } : {}) },
        body: JSON.stringify({ action }),
      });
      return response.ok ? await response.json() : { status: "unknown" };
    } catch { return { status: "unknown" }; }
  }, [deviceId]);

  const check = useCallback(async () => {
    const next = await ask("enter");
    // Coming off the line is worth saying out loud once.
    const turn = latest.current.status === "queued" && next.status === "active";
    setAdmission({ ...next, at: Date.now(), turn });
    return next;
  }, [ask]);

  // Ask when the chat opens; give the spot back if it closes while still waiting.
  useEffect(() => {
    check();
    return () => { if (latest.current.status === "queued") ask("leave"); };
  }, [check, ask]);

  // While waiting, checking in is also what keeps the spot in line.
  useEffect(() => {
    const every = CHECK_EVERY[admission.status];
    if (!every) return undefined;
    const timer = setInterval(check, every);
    return () => clearInterval(timer);
  }, [admission.status, check]);

  // Before a message is sent: does this visitor hold a place right now?
  const ready = useCallback(async () => {
    const current = latest.current;
    const fresh = HOLDS_PLACE.includes(current.status) && Date.now() - (current.at || 0) < 20000 ? current : await check();
    return HOLDS_PLACE.includes(fresh.status);
  }, [check]);

  return { admission, ready };
}

const wait = (seconds) => (seconds < 90 ? "about a minute" : `about ${Math.round(seconds / 60)} minutes`);
const box = {
  flexShrink: 0, padding: "9px 12px", borderTop: "1px solid var(--cw-input-border, #e5e7eb)", background: "var(--cw-input-bg, #ffffff)",
  color: "var(--cw-input-text, #1f2937)", fontSize: 12.5, lineHeight: 1.5,
};
const link = { color: "inherit", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 };

// Shown above the message box. Nothing is shown to someone who simply holds a place.
export function ChatAdmissionNotice({ admission }) {
  if (admission.status === "queued") {
    const ahead = Number(admission.ahead) || 0;
    return (
      <div role="status" style={box} data-chat-line="queued">
        <strong>You are in line.</strong>{" "}
        {ahead === 0 ? "You are next" : `${ahead} ${ahead === 1 ? "person is" : "people are"} ahead of you`}, {wait(Number(admission.eta) || 60)}.
        {" "}Keep this open and it starts by itself; you can write your question while you wait.
      </div>
    );
  }
  if (admission.status === "full") {
    return (
      <div role="status" style={box} data-chat-line="full">
        {admission.reason === "daily" && <><strong>Today’s chat places are all taken.</strong> They open again tomorrow. </>}
        {admission.reason === "line" && <><strong>The line for the chat is full right now.</strong> Try again in a few minutes. </>}
        {admission.reason === "network" && <><strong>This network already holds several places in the chat.</strong> Close another tab, or try again shortly. </>}
        {admission.reason !== "network" && <Link href="/talk"><a style={link}>Leave me a message instead</a></Link>}
      </div>
    );
  }
  if (admission.status === "active" && admission.turn) {
    return <div role="status" style={box} data-chat-line="turn"><strong>It is your turn.</strong> Go ahead and send your question.</div>;
  }
  return null;
}
