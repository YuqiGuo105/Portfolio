import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { prepareBrowserPush, enableBrowserPush, disableBrowserPush } from "../lib/browserPush.mjs";

export default function BrowserPushSettings({ subscriber }) {
  const [prepared, setPrepared] = useState({ state: "loading" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const id = subscriber?.subscriberId, token = subscriber?.subscriberToken;
  useEffect(() => {
    let active = true;
    setError("");
    setPrepared({ state: "loading" });
    prepareBrowserPush({ subscriberId: id, subscriberToken: token }).then(result => {
      if (active) setPrepared(result);
    }).catch(() => {
      if (active) { setPrepared({ state: "unavailable" }); setError("Browser notifications are currently unavailable."); }
    });
    return () => { active = false; };
  }, [id, token, retry]);

  async function toggle() {
    setBusy(true); setError("");
    try {
      setPrepared(await (prepared.state === "enabled" ? disableBrowserPush(prepared, subscriber) : enableBrowserPush(prepared, subscriber)));
    } catch (_) { setError("Couldn't update browser notifications. Please try again."); }
    finally { setBusy(false); }
  }
  const state = prepared.state;
  const messages = {
    loading: "Checking browser notifications...",
    enabled: "Browser notifications are on for this device.",
    ready: "Receive updates even after closing this page.",
    unsupported: "This browser does not support push here. On iPhone or iPad, add this site to your Home Screen and open it there.",
    denied: "Notifications are blocked in your browser settings.",
    unavailable: "Browser notifications are not available yet. Your email and website inbox preferences are unchanged.",
  };
  return <div style={{ margin: "16px 0", textAlign: "left", borderTop: "1px solid #8885", paddingTop: 14 }}>
    <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 12px" }} role="status">{messages[state]}</p>
    {error && <p role="alert" style={{ fontSize: 13 }}>{error}</p>}
    {["ready", "enabled"].includes(state) && <button type="button" disabled={busy} onClick={toggle}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", height: "auto", lineHeight: 1.4, borderRadius: 6, fontSize: 14, background: "#146e71", color: "#fff", border: 0 }}>
      {state === "enabled" ? <BellOff size={16} /> : <Bell size={16} />}
      {busy ? "Updating..." : state === "enabled" ? "Turn off on this device" : "Enable browser notifications"}
    </button>}
    {state === "unavailable" && <button type="button" onClick={() => setRetry(n => n + 1)} style={{ fontSize: 13, padding: "6px 12px", height: "auto" }}>Retry</button>}
  </div>;
}
