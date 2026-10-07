import { useCallback, useEffect, useRef, useState } from "react";
import { clearSubscriber, loadSubscriber, watchSubscriber } from "../lib/notificationsClient";
import NotificationDropdown from "./NotificationDropdown";
import { Bell } from "lucide-react";
import styles from "../../styles/NotificationBell.module.css";

/**
 * Bell icon + unread badge that lives in the site header.
 * - reads subscriberId / subscriberToken from localStorage
 * - uses the subscriber-verified API on changes, opening, focus and visible polling
 *
 * If no subscriber exists in localStorage, the bell is hidden.
 */
export default function NotificationBell({ onOpenSubscribe, isDark = false }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState([]);
  const [subscriber, setSubscriber] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(null);
  const markingRef = useRef(new Set());
  const [error, setError] = useState("");

  const fetchNotifications = useCallback(async (sub) => {
    if (!sub) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        subscriberId: sub.subscriberId,
        subscriberToken: sub.subscriberToken,
      });
      const res = await fetch(`/api/notifications?${qs.toString()}`, { signal: controller.signal, cache: "no-store" });
      if (requestRef.current !== controller) return;
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
          clearSubscriber();
        }
        throw new Error("Notification request failed");
      }
      const data = await res.json();
      if (requestRef.current !== controller || controller.signal.aborted) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount || 0));
      setError("");
    } catch (_) {
      if (requestRef.current === controller) setError("Couldn't load notifications. Try refreshing.");
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) { requestRef.current = null; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    return watchSubscriber(sub => {
      requestRef.current?.abort(); requestRef.current = null;
      setSubscriber(sub); setOpen(false); setItems([]); setUnreadCount(0); setError("");
    });
  }, []);

  // No direct database subscription: only the server verifies inbox ownership.
  useEffect(() => {
    if (!subscriber) return;
    const refresh = () => { if (!document.hidden && !requestRef.current) fetchNotifications(subscriber); };
    refresh();
    const interval = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      requestRef.current?.abort(); requestRef.current = null;
    };
  }, [subscriber, fetchNotifications]);

  const handleMarkRead = useCallback(
    async (recipientId) => {
      if (!subscriber || markingRef.current.has(recipientId)) return;
      markingRef.current.add(recipientId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`/api/notifications/${recipientId}/read`, {
          method: "PATCH",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriberId: subscriber.subscriberId,
            subscriberToken: subscriber.subscriberToken,
          }),
        });
        if (!res.ok) throw new Error("Mark read failed");
        if (loadSubscriber()?.subscriberToken === subscriber.subscriberToken) await fetchNotifications(subscriber);
      } catch (_) {
        setError("Couldn't mark the notification as read. Please try again.");
      } finally {
        clearTimeout(timer); markingRef.current.delete(recipientId);
      }
    },
    [subscriber, fetchNotifications]
  );

  if (!subscriber) {
    // Nudge unsubscribed visitors toward the subscribe flow if a handler is provided.
    if (!onOpenSubscribe) return null;
    return (
      <button
        type="button"
        className={styles.bell}
        onClick={onOpenSubscribe}
        aria-label="Subscribe to notifications"
        style={bellButtonStyle}
        title="Subscribe to notifications"
      >
        <Bell size={22} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className={styles.bell}
        ref={anchorRef}
        onClick={() => { if (!open) fetchNotifications(subscriber); setOpen((o) => !o); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications (${unreadCount} unread)`}
        style={bellButtonStyle}
      >
        <Bell size={22} aria-hidden="true" />
        {unreadCount > 0 && (
          <span style={badgeStyle} aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <NotificationDropdown
          items={items}
          anchorRef={anchorRef}
          loading={loading}
          error={error}
          onClose={() => setOpen(false)}
          onMarkRead={handleMarkRead}
          onRefresh={() => fetchNotifications(subscriber)}
          isDark={isDark}
          onSettings={() => { setOpen(false); onOpenSubscribe?.(); }}
        />
      )}
    </div>
  );
}

const bellButtonStyle = {
  position: "relative",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 6,
  color: "inherit",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const badgeStyle = {
  position: "absolute",
  top: 0,
  right: 0,
  background: "#e63946",
  color: "#fff",
  borderRadius: 12,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  fontSize: 11,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};
