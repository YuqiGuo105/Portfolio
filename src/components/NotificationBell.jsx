import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase/supabaseClient";
import { loadSubscriber } from "../lib/notificationsClient";
import NotificationDropdown from "./NotificationDropdown";

/**
 * Bell icon + unread badge that lives in the site header.
 * - reads subscriberId / subscriberToken from localStorage
 * - polls GET /api/notifications once on mount
 * - subscribes to Supabase Realtime INSERT events on notification_recipients
 *   (filtered by subscriber_id) and re-fetches when a new WEB row appears
 *
 * If no subscriber exists in localStorage, the bell is hidden.
 */
export default function NotificationBell({ onOpenSubscribe, isDark = false }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState([]);
  const [subscriber, setSubscriber] = useState(null);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef(null);

  const fetchNotifications = useCallback(async (sub) => {
    if (!sub) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        subscriberId: sub.subscriberId,
        subscriberToken: sub.subscriberToken,
      });
      const res = await fetch(`/api/notifications?${qs.toString()}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
          // stale token — silently disable
          setSubscriber(null);
        }
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount || 0));
    } catch (_) {
      /* offline / abort — keep stale data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sub = loadSubscriber();
    if (!sub) return;
    setSubscriber(sub);
    fetchNotifications(sub);
  }, [fetchNotifications]);

  // Realtime: subscribe to INSERTs on notification_recipients for this subscriber
  useEffect(() => {
    if (!subscriber) return;
    const channel = supabase
      .channel(`nr-${subscriber.subscriberId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification_recipients",
          filter: `subscriber_id=eq.${subscriber.subscriberId}`,
        },
        (payload) => {
          // Only refresh for WEB rows; EMAIL rows don't change the bell.
          const row = payload && payload.new;
          if (row && row.channel === "WEB") {
            fetchNotifications(subscriber);
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [subscriber, fetchNotifications]);

  const handleMarkRead = useCallback(
    async (recipientId) => {
      if (!subscriber) return;
      try {
        const res = await fetch(`/api/notifications/${recipientId}/read`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriberId: subscriber.subscriberId,
            subscriberToken: subscriber.subscriberToken,
          }),
        });
        if (res.ok) {
          setItems((prev) =>
            prev.map((it) =>
              it.recipientId === recipientId ? { ...it, status: "READ" } : it
            )
          );
          setUnreadCount((c) => Math.max(0, c - 1));
        }
      } catch (_) {
        /* ignore */
      }
    },
    [subscriber]
  );

  if (!subscriber) {
    // Nudge unsubscribed visitors toward the subscribe flow if a handler is provided.
    if (!onOpenSubscribe) return null;
    return (
      <button
        type="button"
        onClick={onOpenSubscribe}
        aria-label="Subscribe to notifications"
        style={bellButtonStyle}
        title="Subscribe to notifications"
      >
        <BellIcon />
      </button>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications (${unreadCount} unread)`}
        style={bellButtonStyle}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span style={badgeStyle} aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <NotificationDropdown
          items={items}
          loading={loading}
          onClose={() => setOpen(false)}
          onMarkRead={handleMarkRead}
          onRefresh={() => fetchNotifications(subscriber)}
          isDark={isDark}
        />
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
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
