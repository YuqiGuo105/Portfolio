import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { BROWSER_ACTION_EVENT, executeBrowserAction } from "../lib/browserActions.mjs";

export default function BrowserActionHost() {
  const router = useRouter();
  const busy = useRef(false);
  useEffect(() => {
    const execute = async ({ detail }) => {
      if (typeof detail?.complete !== "function") return;
      if (busy.current || router.pathname.startsWith("/admin")) {
        detail.complete(new Error("Page controls are unavailable right now.")); return;
      }
      busy.current = true;
      let timer;
      let expired = false;
      const isActive = () => !expired && (typeof detail.isActive !== "function" || detail.isActive());
      try {
        const result = await Promise.race([
          executeBrowserAction(detail.action, router, isActive),
          new Promise((_, reject) => { timer = setTimeout(() => {
            expired = true; reject(new Error("Page action timed out."));
          }, 14000); }),
        ]);
        detail.complete(null, result);
      }
      catch (error) { detail.complete(error); }
      finally { clearTimeout(timer); busy.current = false; }
    };
    window.addEventListener(BROWSER_ACTION_EVENT, execute);
    return () => window.removeEventListener(BROWSER_ACTION_EVENT, execute);
  }, [router]);
  return null;
}
