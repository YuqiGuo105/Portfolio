import { useEffect, useRef } from "react";

/**
 * Dropdown panel rendered by NotificationBell.
 * Props:
 *   - items: [{ recipientId, notificationId, topic, title, body, url, status, createdAt }]
 *   - loading: boolean
 *   - onClose: () => void
 *   - onMarkRead: (recipientId) => Promise<void>
 *   - onRefresh: () => void
 */
export default function NotificationDropdown({ items, loading, onClose, onMarkRead, onRefresh, isDark = false }) {
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose && onClose();
    }
    function onKey(e) { if (e.key === "Escape") onClose && onClose(); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dk = isDark;
  const panel = { ...panelStyle, background: dk ? "#1e1e2a" : "#fff", color: dk ? "#e8e8e8" : "#111", boxShadow: dk ? "0 10px 30px rgba(0,0,0,0.5)" : panelStyle.boxShadow };
  const hdr = { ...headerStyle, background: dk ? "#1e1e2a" : "#fff", borderBottom: `1px solid ${dk ? "#333" : "#eee"}` };
  const refBtn = { ...refreshBtnStyle, border: `1px solid ${dk ? "#444" : "#ddd"}`, color: dk ? "#ccc" : "inherit" };

  return (
    <div ref={ref} role="menu" aria-label="Notifications" style={panel}>
      <div style={hdr}>
        <strong style={{ fontSize: 14 }}>Notifications</strong>
        <button type="button" onClick={onRefresh} disabled={loading} style={refBtn} aria-label="Refresh">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {items.length === 0 ? (
        <div style={emptyStyle}>
          {loading ? "Loading…" : "You're all caught up."}
        </div>
      ) : (
        <ul style={listStyle}>
          {items.map((item) => {
            const unread = item.status === "PENDING" || item.status === "SENT";
            return (
              <li
                key={item.recipientId}
                style={{ ...itemStyle, background: unread ? (dk ? "#252535" : "#f5f8ff") : (dk ? "#1e1e2a" : "#fff") }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <a
                    href={item.url || "#"}
                    target={item.url ? "_blank" : undefined}
                    rel="noreferrer noopener"
                    onClick={() => unread && onMarkRead && onMarkRead(item.recipientId)}
                    style={{ color: dk ? "#e8e8e8" : "#111", textDecoration: "none", flex: 1 }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                    {item.body && (
                      <div style={{ fontSize: 12, color: dk ? "#aaa" : "#444", lineHeight: 1.35 }}>
                        {item.body.length > 140 ? `${item.body.slice(0, 140)}…` : item.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: dk ? "#777" : "#888", marginTop: 4 }}>
                      {formatDate(item.createdAt)} · {labelForTopic(item.topic)}
                    </div>
                  </a>
                  {unread && (
                    <button
                      type="button"
                      onClick={() => onMarkRead && onMarkRead(item.recipientId)}
                      style={markBtnStyle}
                      title="Mark as read"
                    >
                      ✓
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

function labelForTopic(t) {
  switch (t) {
    case "ARTICLE_UPDATES": return "Article";
    case "FEATURE_UPDATES": return "Feature";
    case "JOB_UPDATES": return "Job";
    default: return t || "";
  }
}

const panelStyle = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 8px)",
  width: 340,
  maxHeight: 420,
  overflowY: "auto",
  background: "#fff",
  color: "#111",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  zIndex: 9998,
};

const headerStyle = {
  position: "sticky",
  top: 0,
  background: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
};

const refreshBtnStyle = {
  background: "none",
  border: "1px solid #ddd",
  borderRadius: 4,
  width: 26,
  height: 26,
  cursor: "pointer",
};

const emptyStyle = {
  padding: "18px 12px",
  textAlign: "center",
  fontSize: 13,
  color: "#666",
};

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

const itemStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
};

const markBtnStyle = {
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  width: 26,
  height: 26,
  fontSize: 14,
  flexShrink: 0,
};
