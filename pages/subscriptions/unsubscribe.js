import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { BellOff } from "lucide-react";

export default function Unsubscribe() {
  const router = useRouter();
  const captured = useRef(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!router.isReady || captured.current) return;
    captured.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (!value) setError("Open the unsubscribe link in your notification email.");
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [router.isReady]);

  async function unsubscribe() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/subscriptions/unsubscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok || !data.unsubscribed) {
        setError("This link is no longer valid. Please use the link in your latest notification email.");
        return;
      }
      setDone(true);
      setToken("");
    } catch { setError("Unable to unsubscribe right now. Please try again."); }
    finally { setBusy(false); }
  }

  return <>
    <Head><title>Unsubscribe | Yuqi Guo</title><meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /></Head>
    <main className="unsubscribe">
      <BellOff size={32} aria-hidden="true" />
      <h1>{done ? "You are unsubscribed" : "Unsubscribe from updates"}</h1>
      <p>{done ? "You will no longer receive subscription updates." : "Stop email and website subscription updates from Yuqi."}</p>
      {error && <p role="alert">{error}</p>}
      {!done && <button type="button" onClick={unsubscribe} disabled={!token || busy}>{busy ? "Unsubscribing..." : "Unsubscribe"}</button>}
      <Link href="/"><a className="subscription-back">Return to portfolio</a></Link>
    </main>
    <style jsx>{`
      .unsubscribe { width: min(100% - 40px, 520px); margin: 80px auto; color: #202c2b; background: #fff; padding: 24px; }
      .unsubscribe h1 { color: #202c2b; font-size: 26px; line-height: 1.25; margin: 20px 0 12px; }
      p { font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
      .unsubscribe button { position: relative; background: #176955; color: #fff; border: 0; border-radius: 6px; min-height: 44px; padding: 12px 18px; margin-bottom: 24px; font: 600 16px/1.4 Arial, sans-serif; }
      button::before, button::after { display: none; }
      button:disabled { opacity: .55; cursor: default; }
      .subscription-back { display: block; color: #176955; text-decoration: underline; font-size: 16px; }
      [role="alert"] { color: #a52828; }
    `}</style>
  </>;
}
