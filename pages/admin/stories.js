import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, ImagePlus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";
import { supabase } from "../../src/supabase/supabaseClient";
import styles from "../../src/components/admin/StoryManager.module.css";

export default function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [config, setConfig] = useState({ maxBytes: 10 * 1024 * 1024, maxStories: 10, ttlSeconds: 86400 });
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminApi.stories.list();
      setStories(Array.isArray(payload.stories) ? payload.stories : []);
      if (payload.config) setConfig(payload.config);
    } catch (err) {
      setError(err.message || "Stories could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function uploadStory(event) {
    event.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const prepared = await adminApi.stories.prepareUpload({
        contentType: file.type,
        size: file.size,
        description,
      });
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket)
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      await adminApi.stories.finalize({
        id: prepared.id,
        path: prepared.path,
        contentType: file.type,
        size: file.size,
        description,
      });
      setFile(null);
      setDescription("");
      setNotice("Story published. It will expire automatically after 24 hours.");
      await load();
    } catch (err) {
      setError(err.message || "Story upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function removeStory(story) {
    if (!window.confirm("Remove this story now? The image will be deleted from storage.")) return;
    setError("");
    try {
      await adminApi.stories.remove(story.id);
      setStories((items) => items.filter((item) => item.id !== story.id));
      setNotice("Story removed.");
    } catch (err) {
      setError(err.message || "Story could not be removed.");
    }
  }

  const maxMb = Math.floor(Number(config.maxBytes || 0) / 1024 / 1024);
  const atCapacity = stories.length >= Number(config.maxStories || 10);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Stories"
          subtitle="Publish temporary photos to the profile story ring. Images are private in Supabase Storage and expire automatically after 24 hours."
          actions={(
            <button type="button" className={ui.buttonSecondary} onClick={load} disabled={loading || uploading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="Story lifecycle summary">
          <Metric label="Active stories" value={stories.length} hint={`${config.maxStories || 10} maximum`} />
          <Metric label="Lifetime" value="24h" hint="Sliding is disabled" />
          <Metric label="Storage" value="Private" hint="Signed URLs only" />
          <Metric label="Upload limit" value={`${maxMb || 10} MB`} hint="JPEG, PNG or WebP" />
        </section>

        {error && <div className={ui.errorBanner}>{error}</div>}
        {notice && <div className={styles.successBanner}>{notice}</div>}

        <section className={styles.workspace}>
          <form className={styles.uploadPanel} onSubmit={uploadStory}>
            <div className={styles.panelHeading}>
              <ImagePlus size={18} aria-hidden="true" />
              <div><h2>New story</h2><p>The browser uploads directly to Storage using a short-lived signed token.</p></div>
            </div>

            <label className={`${styles.dropzone} ${file ? styles.dropzoneSelected : ""}`}>
              {preview ? <img src={preview} alt="Selected story preview" /> : <UploadCloud size={32} aria-hidden="true" />}
              <span>{file ? file.name : "Choose a photo"}</span>
              <small>{file ? formatBytes(file.size) : `JPEG, PNG or WebP · up to ${maxMb || 10} MB`}</small>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading || atCapacity}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>

            <label className={styles.field}>
              <span>Caption</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={160}
                rows={4}
                placeholder="A short story caption"
              />
              <small>{description.length} / 160</small>
            </label>

            <button type="submit" className={ui.buttonPrimary} disabled={!file || uploading || atCapacity}>
              <UploadCloud size={15} /> {uploading ? "Publishing…" : atCapacity ? "Story limit reached" : "Publish story"}
            </button>
          </form>

          <section className={styles.library} aria-label="Active stories">
            <div className={styles.panelHeading}>
              <Clock3 size={18} aria-hidden="true" />
              <div><h2>Active stories</h2><p>Expired photos disappear immediately and are removed by the cleanup job.</p></div>
            </div>
            <DataState loading={loading} error={error && !stories.length ? error : ""} empty={!loading && !error && stories.length === 0} onRetry={load}>
              <div className={styles.storyGrid}>
                {stories.map((story) => (
                  <article className={styles.storyItem} key={story.id}>
                    <img src={story.url} alt={story.description || "Portfolio story"} />
                    <div className={styles.storyMeta}>
                      <strong>{story.description || "Untitled story"}</strong>
                      <span>Expires {formatRelative(story.expiresAt)}</span>
                    </div>
                    <button type="button" className={ui.iconButton} onClick={() => removeStory(story)} aria-label="Delete story" title="Delete story">
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            </DataState>
          </section>
        </section>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value, hint }) {
  return <div className={ui.metric}><div className={ui.metricLabel}>{label}</div><div className={ui.metricValue}>{value}</div><div className={ui.metricHint}>{hint}</div></div>;
}

function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelative(value) {
  const remaining = Date.parse(value) - Date.now();
  if (remaining <= 0) return "now";
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.max(1, Math.floor((remaining % 3600000) / 60000));
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}
