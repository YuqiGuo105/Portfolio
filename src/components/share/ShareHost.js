import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { SHARE_EVENT } from "../../lib/share/open.mjs";

const ShareSheet = dynamic(() => import("./ShareSheet"), { ssr: false });

export default function ShareHost() {
  const [content, setContent] = useState(null);
  const router = useRouter();
  const close = useCallback(() => setContent(null), []);
  useEffect(() => {
    const open = event => { if (event.detail?.kind === "card") setContent(event.detail); };
    window.addEventListener(SHARE_EVENT, open);
    return () => window.removeEventListener(SHARE_EVENT, open);
  }, []);
  useEffect(close, [router.asPath, close]);
  return content ? <ShareSheet content={content} onClose={close} /> : null;
}
