import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { loadSubscriber } from "../lib/notificationsClient";
import { startSubscriptionPrompt } from "../lib/subscriptionPrompt.mjs";
import SubscribeDialog from "./SubscribeDialog";

export default function SubscriptionPrompt({ isDark }) {
  const router = useRouter();
  const page = router.asPath.split(/[?#]/)[0];
  const preview = process.env.NODE_ENV === "development" && router.query.subscriptionPreview === "1";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    const stop = startSubscriptionPrompt({
      win: window, doc: document, page,
      ignoreCooldown: preview,
      hasSubscriber: () => Boolean(loadSubscriber()),
      onPrompt: () => setOpen(true),
    });
    const onNavigate = () => { stop(); setOpen(false); };
    router.events.on("routeChangeStart", onNavigate);
    return () => { stop(); router.events.off("routeChangeStart", onNavigate); };
  }, [page, router.events, preview]);

  return <SubscribeDialog open={open} onClose={() => setOpen(false)} isDark={isDark} invitation />;
}
