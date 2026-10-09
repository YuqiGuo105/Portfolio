import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { MailCheck } from "lucide-react";
import { saveSubscriber } from "../../src/lib/notificationsClient";
import BrowserPushSettings from "../../src/components/BrowserPushSettings";

export default function ConfirmSubscription() {
  const router = useRouter();
  const captured = useRef(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [subscriber, setSubscriber] = useState(null);
  useEffect(() => {
    if (!router.isReady || captured.current) return;
    captured.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (!value) setError("Open the confirmation link in your subscription email.");
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [router.isReady]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/subscriptions/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok || !data.subscriberId || !data.subscriberToken) {
        setError("This confirmation link is invalid, expired, or already used. Please request a new subscription link.");
        return;
      }
      saveSubscriber(data.subscriberId, data.subscriberToken, {
        unsubscribeToken: data.unsubscribeToken, topics: data.topics, channels: data.channels,
      });
      setToken("");
      setSubscriber(data);
    } catch {
      setError("Unable to confirm right now. Please try again.");
    } finally { setBusy(false); }
  }

  return <>
    <Head><title>Confirm subscription | Yuqi Guo</title><meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /></Head>
    <main className="subscription-confirmation">
      <MailCheck size={32} aria-hidden="true" />
      <h1>{subscriber ? "Subscription confirmed" : "Confirm your subscription"}</h1>
      <p>{subscriber ? "Your preferences are saved. You can unsubscribe anytime." : "Receive the updates you selected from Yuqi. Confirm only if you requested this subscription."}</p>
      {error && <p role="alert">{error}</p>}
      {!subscriber && <button type="button" disabled={busy || !token} onClick={confirm}>{busy ? "Confirming..." : "Confirm subscription"}</button>}
      {subscriber?.channels?.includes("WEB") && <BrowserPushSettings subscriber={subscriber} />}
      <Link href="/"><a className="subscription-back">Return to portfolio</a></Link>
    </main>
    <style jsx>{`
      .subscription-confirmation { width: min(100% - 40px, 520px); margin: 80px auto; color: #202c2b; background: #fff; padding: 24px; }
      .subscription-confirmation h1 { color: #202c2b; font-size: 26px; line-height: 1.25; margin: 20px 0 12px; }
      p { font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
      .subscription-confirmation button { position: relative; background: #176955; color: white; border: 0; border-radius: 6px; min-height: 44px; padding: 12px 18px; margin-bottom: 24px; font: 600 16px/1.4 Arial, sans-serif; }
      button::before, button::after { display: none; }
      button:disabled { opacity: .55; cursor: default; }
      .subscription-back { display: block; color: #176955; text-decoration: underline; font-size: 16px; }
      [role="alert"] { color: #a52828; }
    `}</style>
  </>;
}
