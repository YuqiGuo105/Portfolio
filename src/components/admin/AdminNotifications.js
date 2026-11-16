import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, RefreshCw } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { writerApi } from "../../lib/writerApi";
import { ago, gatherNotifications, rememberSeen, unseenCount } from "../../lib/adminNotifications.mjs";
import styles from "./AdminLayout.module.css";

const SEEN_KEY = "admin:notifications:seen:v1";
const REFRESH_MS = 2 * 60 * 1000;
const api = {
  alerts: () => adminApi.visitorAlerts.overview({ hours: 24 }),
  referrals: () => adminApi.referrals.list(),
  flags: () => adminApi.globeFlags.list("pending"),
  reviews: () => adminApi.discovery.request(),
  failures: () => writerApi.recovery.failures({ limit: 20 }),
};
const readSeen = () => { try { const value = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };

// The bell beside the account in the admin top bar: audience alerts, new referral requests, things
// waiting for review and failed background jobs, each linking to the page that deals with it.
export default function AdminNotifications({ source = api }) {
  const [state, setState] = useState({ groups: [], unchecked: [], keys: [], total: 0 });
  const [seen, setSeen] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const root = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setState(await gatherNotifications(source)); } finally { setLoading(false); }
  }, [source]);

  useEffect(() => {
    setSeen(readSeen());
    load();
    // Checks again every two minutes while the tab is being looked at, and when it is returned to.
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event) => { if (root.current && !root.current.contains(event.target)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  const fresh = unseenCount(state.keys, seen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.keys.length) {
      const remembered = rememberSeen(state.keys, seen);
      setSeen(remembered);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(remembered)); } catch { /* optional */ }
    }
  };

  return (
    <div className={styles.bellWrap} ref={root}>
      <button type="button" className={styles.bell} onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
        aria-label={fresh ? `Notifications, ${fresh} new` : state.total ? `Notifications, ${state.total} waiting` : "Notifications"}>
        <Bell size={18} aria-hidden="true" />
        {fresh > 0 && <span className={styles.bellBadge} aria-hidden="true">{fresh > 99 ? "99+" : fresh}</span>}
        {fresh === 0 && state.total > 0 && <span className={styles.bellDot} aria-hidden="true" />}
      </button>
      {open && (
        <div className={styles.bellPanel} role="dialog" aria-label="Notifications">
          <div className={styles.bellHead}>
            <strong>Notifications</strong>
            <button type="button" className={styles.bellRefresh} onClick={load} disabled={loading}><RefreshCw size={13} aria-hidden="true" /> {loading ? "Checking…" : "Check again"}</button>
          </div>
          {!state.groups.length && <p className={styles.bellEmpty}>{loading ? "Checking…" : "Nothing is waiting for you."}</p>}
          {state.groups.map((group) => (
            <section key={group.id} className={styles.bellGroup}>
              <Link href={group.href}><a className={styles.bellGroupTitle} onClick={() => setOpen(false)}>{group.label}<span>{group.total}</span></a></Link>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link href={group.href}><a className={styles.bellItem} onClick={() => setOpen(false)}>
                      <span className={styles.bellItemTitle}>{item.title}</span>
                      {item.detail && <span className={styles.bellItemDetail}>{item.detail}</span>}
                      {item.at > 0 && <span className={styles.bellItemTime}>{ago(item.at)}</span>}
                    </a></Link>
                  </li>
                ))}
              </ul>
              {group.more > 0 && <Link href={group.href}><a className={styles.bellMore} onClick={() => setOpen(false)}>and {group.more} more</a></Link>}
            </section>
          ))}
          {state.unchecked.length > 0 && <p className={styles.bellNote}>Could not check: {state.unchecked.join(", ")}.</p>}
        </div>
      )}
    </div>
  );
}
