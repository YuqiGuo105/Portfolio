import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { loadSubscriber } from "../lib/notificationsClient";
import { startSubscriptionPrompt, subscriptionPromptOnCooldown, subscriptionPromptPreviewMode } from "../lib/subscriptionPrompt.mjs";
import SubscribeDialog from "./SubscribeDialog";

export default function SubscriptionPrompt({ isDark }) {
  const router = useRouter();
  const page = router.asPath.split(/[?#]/)[0];
  const preview = subscriptionPromptPreviewMode(process.env.NODE_ENV, router.query.subscriptionPreview);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    if (process.env.NODE_ENV === "development") {
      console.info("[SubscriptionPrompt]", JSON.stringify({
        page, preview, cooldown: subscriptionPromptOnCooldown(window),
        subscribed: Boolean(loadSubscriber()),
      }));
    }
    const stop = startSubscriptionPrompt({
      win: window, doc: document, page,
      ignoreCooldown: preview,
      hasSubscriber: () => Boolean(loadSubscriber()),
      onPrompt: details => {
        if (process.env.NODE_ENV === "development") console.info("[SubscriptionPrompt] opening", JSON.stringify(details));
        setOpen(true);
      },
    });
    const onNavigate = () => { stop(); setOpen(false); };
    router.events.on("routeChangeStart", onNavigate);
    return () => { stop(); router.events.off("routeChangeStart", onNavigate); };
  }, [page, router.events, preview]);

  return <SubscribeDialog open={open} onClose={() => setOpen(false)} isDark={isDark} invitation />;
}
