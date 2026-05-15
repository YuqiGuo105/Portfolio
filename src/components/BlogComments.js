import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase/supabaseClient";

export default function BlogComments({ blogId, blogType = "technical" }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [draft, setDraft] = useState({
    author_name: "",
    author_email: "",
    content: "",
  });

  const load = useCallback(async () => {
    if (!blogId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("blog_comments")
      .select("id, author_name, content, created_at")
      .eq("blog_id", String(blogId))
      .eq("blog_type", blogType)
      .eq("is_approved", true)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("load comments failed", error);
    } else {
      setComments(data || []);
    }
    setLoading(false);
  }, [blogId, blogType]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const author_name = draft.author_name.trim();
    const author_email = draft.author_email.trim();
    const content = draft.content.trim();
    if (!author_name || !author_email || !content) {
      setStatusMsg("Please fill in name, email and comment.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("blog_comments").insert({
        blog_id: String(blogId),
        blog_type: blogType,
        author_name,
        author_email,
        content,
      });
      if (error) throw error;
      setDraft({ author_name: "", author_email: "", content: "" });
      setStatusMsg("Comment posted.");
      setTimeout(() => setStatusMsg(""), 2500);
      await load();
    } catch (err) {
      console.error(err);
      setStatusMsg(`Failed: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="blog-comments" style={{ marginTop: 32 }}>
      <h3 style={{ marginBottom: 12 }}>
        Comments {comments.length ? `(${comments.length})` : ""}
      </h3>

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading comments…</p>
      ) : comments.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No comments yet. Be the first.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {comments.map((c) => (
            <li
              key={c.id}
              style={{
                padding: "12px 14px",
                marginBottom: 10,
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: "0.9rem", marginBottom: 4 }}>
                <strong>{c.author_name}</strong>{" "}
                <span style={{ color: "#6b7280", fontSize: "0.78rem" }}>
                  · {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  color: "#1f2937",
                  fontSize: "0.92rem",
                  lineHeight: 1.55,
                }}
              >
                {c.content}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          marginTop: 20,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <h4 style={{ marginTop: 0, marginBottom: 12 }}>Leave a comment</h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <input
            type="text"
            placeholder="Your name"
            value={draft.author_name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, author_name: e.target.value }))
            }
            style={{
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: "0.9rem",
            }}
            required
          />
          <input
            type="email"
            placeholder="Your email"
            value={draft.author_email}
            onChange={(e) =>
              setDraft((d) => ({ ...d, author_email: e.target.value }))
            }
            style={{
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: "0.9rem",
            }}
            required
          />
        </div>
        <textarea
          placeholder="Your comment"
          value={draft.content}
          onChange={(e) =>
            setDraft((d) => ({ ...d, content: e.target.value }))
          }
          rows={4}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: "0.9rem",
            fontFamily: "inherit",
            resize: "vertical",
            marginBottom: 10,
          }}
          required
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          {statusMsg && (
            <span style={{ marginRight: "auto", color: "#6b7280", fontSize: "0.85rem" }}>
              {statusMsg}
            </span>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "1px solid #2563eb",
              background: submitting ? "#93c5fd" : "#2563eb",
              color: "#fff",
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Posting…" : "Post Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}
