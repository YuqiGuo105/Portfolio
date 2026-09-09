import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase/supabaseClient";
import styles from "./BlogComments.module.css";

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
    <div className={`blog-comments ${styles.comments}`}>
      <h3 className={styles.title}>
        Comments {comments.length ? `(${comments.length})` : ""}
      </h3>

      {loading ? (
        <p className={styles.muted}>Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className={styles.muted}>No comments yet. Be the first.</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((c) => (
            <li key={c.id} className={styles.comment}>
              <div className={styles.commentMeta}>
                <strong>{c.author_name}</strong>{" "}
                <span className={styles.commentDate}>
                  · {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div className={styles.commentBody}>{c.content}</div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <h4 className={styles.formTitle}>Leave a comment</h4>
        <div className={styles.fields}>
          <input
            className={styles.input}
            type="text"
            placeholder="Your name"
            value={draft.author_name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, author_name: e.target.value }))
            }
            required
          />
          <input
            className={styles.input}
            type="email"
            placeholder="Your email"
            value={draft.author_email}
            onChange={(e) =>
              setDraft((d) => ({ ...d, author_email: e.target.value }))
            }
            required
          />
        </div>
        <textarea
          className={styles.textarea}
          placeholder="Your comment"
          value={draft.content}
          onChange={(e) =>
            setDraft((d) => ({ ...d, content: e.target.value }))
          }
          rows={4}
          required
        />
        <div className={styles.actions}>
          {statusMsg && (
            <span className={styles.status} role="status">{statusMsg}</span>
          )}
          <button
            className={styles.submit}
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Posting…" : "Post Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}
