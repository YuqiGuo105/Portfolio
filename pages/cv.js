import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  Download,
  LogOut,
  MessageSquareText,
  Pencil,
  Printer,
} from "lucide-react";
import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import LogInDialog from "../src/components/LogInDialog";
import { supabase } from "../src/supabase/supabaseClient";

// Quill (and its CSS) must never be touched server-side.
const ReactQuill = dynamic(
  () =>
    import("react-quill").then((mod) => {
      require("react-quill/dist/quill.snow.css");
      return mod;
    }),
  { ssr: false }
);

const OWNER_EMAIL = "yuqi.guo17@gmail.com";
const CV_BUCKET = "cv-images";
const MAX_QUOTE_LEN = 600;

const QUILL_FORMATS = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "blockquote",
  "list",
  "bullet",
  "indent",
  "link",
  "image",
  "code-block",
  "color",
  "background",
  "align",
];

function sanitizeFilename(name) {
  const original = String(name || "upload").trim();
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot) : "";
  const base = dot >= 0 ? original.slice(0, dot) : original;
  const safeBase =
    base
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]+/g, "").slice(0, 10);
  return safeBase + safeExt;
}

/* Count how many times `needle` occurs inside `haystack` (no overlaps). */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

/**
 * Walk text nodes in `root` (skipping nodes already inside a .cv-mark)
 * and wrap the n-th (0-indexed) occurrence of `quote` (within a single
 * text node) with a <mark class="cv-mark" data-anno-id={annoId}> element.
 * Returns true if it wrapped, false otherwise.
 */
function wrapNthOccurrence(root, quote, n, annoId) {
  if (!quote || !root) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      // skip nodes already inside a previously-rendered mark
      let p = node.parentNode;
      while (p && p !== root) {
        if (p.nodeType === 1 && p.classList?.contains("cv-mark")) {
          return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let seen = 0;
  const collected = [];
  let cur;
  while ((cur = walker.nextNode())) collected.push(cur);

  for (const node of collected) {
    const text = node.nodeValue;
    let idx = -1;
    while ((idx = text.indexOf(quote, idx + 1)) !== -1) {
      if (seen === n) {
        const pre = text.slice(0, idx);
        const match = text.slice(idx, idx + quote.length);
        const post = text.slice(idx + quote.length);
        const parent = node.parentNode;
        if (!parent) return false;
        const frag = document.createDocumentFragment();
        if (pre) frag.appendChild(document.createTextNode(pre));
        const mark = document.createElement("mark");
        mark.className = "cv-mark";
        mark.setAttribute("data-anno-id", annoId);
        mark.appendChild(document.createTextNode(match));
        frag.appendChild(mark);
        if (post) frag.appendChild(document.createTextNode(post));
        parent.replaceChild(frag, node);
        return true;
      }
      seen++;
    }
  }
  return false;
}

export default function CVPage() {
  /* ---------------- state ---------------- */
  const [session, setSession] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [cvRow, setCvRow] = useState(null);
  const [editorHtml, setEditorHtml] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [comments, setComments] = useState([]);
  const [showLogin, setShowLogin] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Inline-comment state
  const [selectionInfo, setSelectionInfo] = useState(null); // {quote, occurrence, top, left}
  const [draftAnchor, setDraftAnchor] = useState(null); // {quote, occurrence, top, left}
  const [draft, setDraft] = useState({
    author_name: "",
    author_email: "",
    content: "",
  });
  const [submittingComment, setSubmittingComment] = useState(false);
  const [activeAnnoId, setActiveAnnoId] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const quillRef = useRef(null);
  const contentRef = useRef(null);
  const popoverRef = useRef(null);
  const sideListRef = useRef(null);

  /* ---------------- derived ---------------- */
  const userEmail = session?.user?.email || "";
  const isOwner = userEmail.toLowerCase() === OWNER_EMAIL;
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "?";
  const userDisplayName = useMemo(() => {
    const meta = session?.user?.user_metadata || {};
    return (
      meta.full_name ||
      meta.name ||
      (userEmail ? userEmail.split("@")[0] : "")
    );
  }, [session, userEmail]);

  const safeHtml = useMemo(() => {
    if (typeof window === "undefined") return cvRow?.content || "";
    return DOMPurify.sanitize(cvRow?.content || "", {
      ADD_ATTR: ["target", "download", "data-resume-pdf"],
    });
  }, [cvRow]);

  const pdfUrl = useMemo(() => {
    if (typeof window === "undefined" || !safeHtml) return "";
    const document = new DOMParser().parseFromString(safeHtml, "text/html");
    return document.querySelector("[data-resume-pdf]")?.getAttribute("href") || "";
  }, [safeHtml]);

  /* ---------------- auth ---------------- */
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session || null);
      setAuthLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s || null);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  /* ---------------- data ---------------- */
  const loadCv = useCallback(async () => {
    const { data, error } = await supabase
      .from("cv_content")
      .select("id, content, updated_at, updated_by")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("load cv failed", error);
      return;
    }
    setCvRow(data || null);
    setEditorHtml(data?.content || "");
  }, []);

  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from("cv_comments")
      .select(
        "id, content, author_name, created_at, anno_id, quote, occurrence_index"
      )
      .eq("is_approved", true)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("load comments failed", error);
      return;
    }
    setComments(data || []);
  }, []);

  useEffect(() => {
    loadCv();
    loadComments();
  }, [loadCv, loadComments]);

  /* ---------------- highlight pass ---------------- */
  // Re-render content + apply highlights whenever content or comments change.
  useLayoutEffect(() => {
    if (editing) return;
    const root = contentRef.current;
    if (!root) return;
    root.innerHTML =
      safeHtml || "<p><em>The CV has not been published yet.</em></p>";
    // Track per-quote occurrence pointer so multiple comments on same quote
    // get the right n-th match, in author-supplied occurrence order.
    const sorted = [...comments]
      .filter((c) => c.anno_id && c.quote)
      .sort(
        (a, b) =>
          (a.occurrence_index || 0) - (b.occurrence_index || 0) ||
          a.created_at.localeCompare(b.created_at)
      );
    sorted.forEach((c) => {
      wrapNthOccurrence(root, c.quote, c.occurrence_index || 0, c.anno_id);
    });
    // Click handler delegation
    const onClick = (e) => {
      const mark = e.target.closest?.(".cv-mark");
      if (!mark) return;
      const id = mark.getAttribute("data-anno-id");
      setActiveAnnoId(id);
      // Scroll comment into view
      requestAnimationFrame(() => {
        const el = sideListRef.current?.querySelector(
          `[data-anno-id="${id}"]`
        );
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [safeHtml, comments, editing]);

  // Keep .is-active class on the highlighted mark.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root
      .querySelectorAll(".cv-mark.is-active")
      .forEach((m) => m.classList.remove("is-active"));
    if (activeAnnoId) {
      root
        .querySelectorAll(`.cv-mark[data-anno-id="${activeAnnoId}"]`)
        .forEach((m) => m.classList.add("is-active"));
    }
  }, [activeAnnoId, comments, safeHtml]);

  /* ---------------- selection -> floating "+" ---------------- */
  const handleContentMouseUp = useCallback(() => {
    if (editing) return;
    const root = contentRef.current;
    if (!root) return;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed) {
      setSelectionInfo(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      setSelectionInfo(null);
      return;
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote || quote.length > MAX_QUOTE_LEN) {
      setSelectionInfo(null);
      return;
    }
    // Skip selections sitting entirely inside an existing mark
    const startMark = range.startContainer?.parentElement?.closest?.(
      ".cv-mark"
    );
    const endMark = range.endContainer?.parentElement?.closest?.(".cv-mark");
    if (startMark && startMark === endMark) {
      setSelectionInfo(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelectionInfo(null);
      return;
    }
    // Count occurrence index = matches before selection start
    const preRange = document.createRange();
    preRange.selectNodeContents(root);
    preRange.setEnd(range.startContainer, range.startOffset);
    const before = preRange.toString().replace(/\s+/g, " ");
    const occurrence = countOccurrences(before, quote);
    setSelectionInfo({
      quote,
      occurrence,
      top: rect.top + window.scrollY - 8,
      left: rect.left + window.scrollX + rect.width / 2,
      bottom: rect.bottom + window.scrollY,
    });
  }, [editing]);

  // Dismiss the "+" floater when the user clicks elsewhere (outside selection
  // and outside the popover).
  useEffect(() => {
    const onDocClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (e.target.closest?.(".cv-add-comment-btn")) return;
      if (e.target.closest?.(".cv-content")) return;
      setSelectionInfo(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const beginAnnotation = () => {
    if (!selectionInfo) return;
    setDraftAnchor(selectionInfo);
    setDraft({ author_name: "", author_email: "", content: "" });
    setSelectionInfo(null);
    // Clear native selection
    if (typeof window !== "undefined")
      window.getSelection()?.removeAllRanges?.();
  };

  const cancelAnnotation = () => {
    setDraftAnchor(null);
    setDraft({ author_name: "", author_email: "", content: "" });
  };

  /* ---------------- submit comment ---------------- */
  const handleSubmitComment = async (e) => {
    e?.preventDefault?.();
    if (!draftAnchor) return;
    const author_name = (session ? userDisplayName : draft.author_name).trim();
    const author_email = (session ? userEmail : draft.author_email).trim();
    const content = draft.content.trim();
    if (!author_name || !author_email || !content) {
      setStatusMsg("Please fill in name, email and comment.");
      return;
    }
    setSubmittingComment(true);
    try {
      const annoId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { error } = await supabase.from("cv_comments").insert({
        author_name,
        author_email,
        content,
        anno_id: annoId,
        quote: draftAnchor.quote,
        occurrence_index: draftAnchor.occurrence,
      });
      if (error) throw error;
      cancelAnnotation();
      await loadComments();
      setActiveAnnoId(annoId);
      setStatusMsg("Comment added.");
      setTimeout(() => setStatusMsg(""), 2500);
    } catch (err) {
      console.error(err);
      setStatusMsg(`Comment failed: ${err?.message || err}`);
    } finally {
      setSubmittingComment(false);
    }
  };

  /* ---------------- save CV ---------------- */
  const uploadImage = useCallback(async (file) => {
    const safeName = sanitizeFilename(file.name);
    const path = `cv/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(CV_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(CV_BUCKET).getPublicUrl(path);
    return data?.publicUrl || "";
  }, []);

  const imageHandler = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const editor = quillRef.current?.getEditor?.();
      const range = editor?.getSelection(true);
      try {
        setStatusMsg("Uploading image…");
        const url = await uploadImage(file);
        if (editor && url) {
          editor.insertEmbed(range?.index ?? 0, "image", url, "user");
          editor.setSelection((range?.index ?? 0) + 1, 0);
        }
        setStatusMsg("");
      } catch (err) {
        console.error(err);
        setStatusMsg(`Image upload failed: ${err?.message || err}`);
      }
    };
    input.click();
  }, [uploadImage]);

  const quillModules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["blockquote", "code-block"],
          ["link", "image"],
          ["clean"],
        ],
        handlers: { image: imageHandler },
      },
      clipboard: { matchVisual: false },
    }),
    [imageHandler]
  );

  const handleSave = async () => {
    if (!isOwner) return;
    setSaving(true);
    setStatusMsg("");
    try {
      let res;
      if (cvRow?.id) {
        res = await supabase
          .from("cv_content")
          .update({
            content: editorHtml,
            updated_at: new Date().toISOString(),
            updated_by: userEmail,
          })
          .eq("id", cvRow.id)
          .select("id, content, updated_at, updated_by")
          .maybeSingle();
      } else {
        res = await supabase
          .from("cv_content")
          .insert({ content: editorHtml, updated_by: userEmail })
          .select("id, content, updated_at, updated_by")
          .maybeSingle();
      }
      if (res.error) throw res.error;
      setCvRow(res.data || null);
      setEditing(false);
      setStatusMsg("Saved.");
      setTimeout(() => setStatusMsg(""), 2500);
    } catch (err) {
      console.error(err);
      setStatusMsg(`Save failed: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditorHtml(cvRow?.content || "");
    setEditing(false);
    setStatusMsg("");
  };

  /* ---------------- login ---------------- */
  const handleLoginConfirm = async (username, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });
      if (error) return { error: "Invalid username or password." };
      setShowLogin(false);
      const loggedEmail = data?.user?.email?.toLowerCase() || "";
      if (pendingAction === "edit") {
        if (loggedEmail === OWNER_EMAIL) setEditing(true);
        else setStatusMsg("Only the site owner can edit the CV.");
      }
      setPendingAction(null);
      return { ok: true };
    } catch (err) {
      return { error: err?.message || "Unable to log in right now." };
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setEditing(false);
  };

  const requestEdit = () => {
    if (!session) {
      setPendingAction("edit");
      setShowLogin(true);
      return;
    }
    if (!isOwner) {
      setStatusMsg("Only the site owner can edit the CV.");
      return;
    }
    setEditing(true);
  };

  const handleClickComment = (id) => {
    setActiveAnnoId(id);
    const root = contentRef.current;
    const mark = root?.querySelector(`.cv-mark[data-anno-id="${id}"]`);
    mark?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleDeleteComment = async (commentId, e) => {
    e?.stopPropagation?.();
    if (!session) {
      setPendingAction(null);
      setShowLogin(true);
      return;
    }
    if (!isOwner) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this comment?")) return;
    try {
      const { data, error } = await supabase
        .from("cv_comments")
        .delete()
        .eq("id", commentId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          "Delete blocked by Supabase RLS. Run the 'Owner can delete cv_comments' policy from creat_sql.txt in the Supabase SQL editor."
        );
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setStatusMsg("Comment deleted.");
      setTimeout(() => setStatusMsg(""), 2000);
    } catch (err) {
      console.error(err);
      setStatusMsg(`Delete failed: ${err?.message || err}`);
    }
  };

  const handlePopoverKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmitComment();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelAnnotation();
    }
  };

  /* ---------------- render ---------------- */
  return (
    <Layout extraWrapClass="cv-page-wrap">
      <SeoHead
        title="Yuqi Guo | Software Engineer Resume"
        description="Yuqi Guo is a software engineer specializing in backend systems, distributed platforms, and AI infrastructure."
      />

      <section className="section">
        <div className="container">
          <div className="cv-page">
            <header className="cv-header cv-toolbar">
              <div className="cv-toolbar-copy">
                <span className="cv-kicker">YUQI.SITE / RESUME</span>
                {cvRow?.updated_at && (
                  <p className="cv-meta">
                    Last updated {new Date(cvRow.updated_at).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="cv-header-actions">
                <Link href="/">
                  <a className="btn btn-ghost" title="Back to portfolio">
                    <ArrowLeft size={16} aria-hidden="true" /> Home
                  </a>
                </Link>
                {pdfUrl && (
                  <a className="btn cv-download-btn" href={pdfUrl} download>
                    <Download size={16} aria-hidden="true" /> Download PDF
                  </a>
                )}
                <button type="button" className="btn btn-ghost cv-icon-command" onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" /> Print
                </button>
                {comments.length > 0 && !editing && (
                  <button
                    type="button"
                    className={`btn btn-ghost cv-icon-command${reviewOpen ? " is-active" : ""}`}
                    onClick={() => setReviewOpen((open) => !open)}
                    aria-pressed={reviewOpen}
                  >
                    <MessageSquareText size={16} aria-hidden="true" /> Review
                  </button>
                )}
                {authLoaded && !editing && (
                  <button
                    type="button"
                    className="btn"
                    onClick={requestEdit}
                  >
                    <Pencil size={16} aria-hidden="true" /> Edit
                  </button>
                )}
                {session && !editing && (
                  <button
                    type="button"
                    className="btn btn-ghost cv-signout"
                    onClick={handleSignOut}
                    title={`Sign out ${userEmail}`}
                    aria-label="Sign out"
                  >
                    <LogOut size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </header>

            {statusMsg && <div className="cv-status">{statusMsg}</div>}

            {editing && isOwner ? (
              <div className="cv-editor">
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  value={editorHtml}
                  onChange={setEditorHtml}
                  modules={quillModules}
                  formats={QUILL_FORMATS}
                />
                <div className="cv-editor-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
              <div className={`cv-doc-grid ${reviewOpen ? "cv-doc-grid--review" : "cv-doc-grid--reading"}`}>
                <article
                  ref={contentRef}
                  className="cv-content"
                  onMouseUp={handleContentMouseUp}
                />

                {reviewOpen && <aside className="cv-side">
                  <div className="cv-side-head">
                    <h2 className="cv-side-title">
                      Comments {comments.length ? `(${comments.length})` : ""}
                    </h2>
                    <p className="cv-side-hint">
                      Select any text on the left to add a comment.
                    </p>
                  </div>

                  <ul className="cv-side-list" ref={sideListRef}>
                    {comments.length === 0 && (
                      <li className="cv-side-empty">
                        No comments yet. Highlight a passage to start a
                        discussion.
                      </li>
                    )}
                    {comments.map((c) => (
                      <li
                        key={c.id}
                        data-anno-id={c.anno_id || ""}
                        className={`cv-side-card${
                          activeAnnoId && c.anno_id === activeAnnoId
                            ? " is-active"
                            : ""
                        }${!c.anno_id ? " cv-side-card--orphan" : ""}`}
                        onClick={() =>
                          c.anno_id && handleClickComment(c.anno_id)
                        }
                      >
                        <div className="cv-side-author">
                          <span
                            className="cv-avatar"
                            aria-hidden="true"
                            style={{ background: stringToColor(c.author_name) }}
                          >
                            {(c.author_name || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          <div className="cv-side-author-text">
                            <strong>{c.author_name}</strong>
                            <div className="cv-side-date">
                              {new Date(c.created_at).toLocaleString()}
                            </div>
                          </div>
                          <button
                              type="button"
                              className="cv-side-delete"
                              onClick={(ev) => handleDeleteComment(c.id, ev)}
                              title={isOwner ? "Delete comment (admin)" : "Sign in to delete"}
                              aria-label="Delete comment"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                        {c.quote && (
                          <blockquote className="cv-side-quote">
                            {c.quote}
                          </blockquote>
                        )}
                        <p className="cv-side-body">{c.content}</p>
                      </li>
                    ))}
                  </ul>
                </aside>}
              </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Floating pill button while text is selected */}
      {!editing && selectionInfo && (
        <button
          type="button"
          className="cv-add-comment-btn"
          style={{
            top: `${selectionInfo.top}px`,
            left: `${selectionInfo.left}px`,
          }}
          onMouseDown={(e) => {
            // Prevent selection collapse before our click handler runs
            e.preventDefault();
          }}
          onClick={beginAnnotation}
          title="Add comment on selection"
        >
          <svg
            className="cv-add-comment-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="cv-add-comment-label">Add comment</span>
          <span className="cv-add-comment-tail" aria-hidden="true" />
        </button>
      )}

      {/* Inline annotation popover */}
      {!editing && draftAnchor && (
        <form
          ref={popoverRef}
          className="cv-anno-popover"
          style={{
            top: `${(draftAnchor.bottom ?? draftAnchor.top + 24) + 14}px`,
            left: `${draftAnchor.left}px`,
          }}
          onSubmit={handleSubmitComment}
          onKeyDown={handlePopoverKeyDown}
        >
          <span className="cv-anno-arrow" aria-hidden="true" />

          <header className="cv-anno-header">
            <div className="cv-anno-author">
              <span
                className="cv-avatar cv-anno-avatar"
                aria-hidden="true"
                style={{
                  background: session
                    ? stringToColor(userDisplayName)
                    : "#9ca3af",
                }}
              >
                {session
                  ? userInitial
                  : (draft.author_name || "?").charAt(0).toUpperCase()}
              </span>
              <div className="cv-anno-author-text">
                <div className="cv-anno-name">
                  {session ? userDisplayName : draft.author_name || "Guest"}
                </div>
                <div className="cv-anno-sub" title={session ? userEmail : ""}>
                  {session ? userEmail : "Commenting as guest"}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="cv-anno-close"
              onClick={cancelAnnotation}
              aria-label="Close"
              title="Close (Esc)"
            >
              ×
            </button>
          </header>

          <blockquote className="cv-anno-quote">
            {draftAnchor.quote}
          </blockquote>

          {!session && (
            <div className="cv-anno-guest">
              <input
                type="text"
                placeholder="Your name"
                value={draft.author_name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, author_name: e.target.value }))
                }
                required
              />
              <input
                type="email"
                placeholder="Email (not published)"
                value={draft.author_email}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, author_email: e.target.value }))
                }
                required
              />
            </div>
          )}

          <textarea
            className="cv-anno-input"
            placeholder="Add a comment about the highlighted text…"
            rows={3}
            autoFocus
            value={draft.content}
            onChange={(e) =>
              setDraft((d) => ({ ...d, content: e.target.value }))
            }
            required
          />
          <div className="cv-anno-actions">
            <span className="cv-anno-hint">⌘/Ctrl + Enter</span>
            <button
              type="button"
              className="cv-link-btn"
              onClick={cancelAnnotation}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cv-pill-btn"
              disabled={submittingComment || !draft.content.trim()}
            >
              {submittingComment ? "Posting…" : "Comment"}
            </button>
          </div>
        </form>
      )}

      <LogInDialog
        open={showLogin}
        onClose={() => setShowLogin(false)}
        onConfirm={handleLoginConfirm}
        title="Owner login"
      />
    </Layout>
  );
}

/* ---------------- helpers ---------------- */
function stringToColor(str) {
  const palette = [
    "#7c3aed",
    "#2563eb",
    "#0d9488",
    "#dc2626",
    "#d97706",
    "#db2777",
    "#059669",
    "#475569",
  ];
  if (!str) return palette[0];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
