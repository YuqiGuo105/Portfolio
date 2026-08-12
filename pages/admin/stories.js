import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, ImagePlus, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";
import { isIphonePhoto, prepareStoryImage, storyImageContentType } from "../../src/lib/storyImageUpload";
import { uploadStoryToSignedUrl } from "../../src/lib/storySignedUpload";
import styles from "../../src/components/admin/StoryManager.module.css";

export default function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [config, setConfig] = useState({ maxBytes: 10 * 1024 * 1024, maxStories: 10, ttlSeconds: 86400 });
  const [files, setFiles] = useState([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(null);
  const filesRef = useRef([]);

  const load = useCallback(async ({ clearFeedback = true } = {}) => {
    setLoading(true);
    if (clearFeedback) {
      setError("");
      setNotice("");
    }
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

  const remainingSlots = Math.max(0, Number(config.maxStories || 10) - stories.length);
  const selectedBytes = useMemo(() => files.reduce((total, item) => total + item.file.size, 0), [files]);

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => () => {
    filesRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
  }, []);

  async function selectPhotos(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length || uploading) return;
    setError("");
    setNotice("");

    const available = Math.max(0, remainingSlots - files.length);
    if (!available) {
      setError(`The active story limit is ${config.maxStories || 10}. Remove a story before adding another photo.`);
      return;
    }

    const accepted = [];
    const rejected = [];
    for (const original of selected.slice(0, available)) {
      try {
        const converted = await prepareStoryImage(original);
        const contentType = storyImageContentType(converted);
        if (!contentType) throw new Error(`${original.name} has no supported image type after preparation.`);
        if (converted.size > Number(config.maxBytes || 0)) {
          throw new Error(`${original.name} exceeds the ${maxMb || 10} MB upload limit after conversion.`);
        }
        accepted.push({
          id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${accepted.length}`,
          file: converted,
          contentType,
          originalName: original.name,
          converted: isIphonePhoto(original),
          preview: URL.createObjectURL(converted),
          status: "ready",
          error: "",
        });
      } catch (err) {
        rejected.push(err.message || `${original.name} could not be prepared.`);
      }
    }

    if (selected.length > available) rejected.push(`${selected.length - available} photo(s) exceeded the active story limit.`);
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
    if (rejected.length) setError(rejected.join(" "));
  }

  async function uploadStory(event) {
    event.preventDefault();
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    setNotice("");
    setProgress({ completed: 0, total: files.length });
    try {
      let published = 0;
      let failed = 0;
      // Upload in reverse so the API's newest-first order preserves the selected sequence.
      for (const item of [...files].reverse()) {
        setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: "" } : entry));
        try {
          const contentType = item.contentType;
          let prepared;
          try {
            prepared = await adminApi.stories.prepareUpload({
              contentType,
              size: item.file.size,
              description,
            });
          } catch (err) {
            throw new Error(`Prepare failed · ${err.message || "Upload could not be prepared."}`);
          }
          try {
            await uploadStoryToSignedUrl({
              signedUrl: prepared.signedUrl,
              file: item.file,
              contentType,
            });
          } catch (err) {
            throw new Error(`Storage failed · ${err.message || "Image upload failed."}`);
          }
          try {
            await adminApi.stories.finalize({
            id: prepared.id,
            path: prepared.path,
            contentType,
            size: item.file.size,
            description,
            });
          } catch (err) {
            throw new Error(`Finalize failed · ${err.message || "Story could not be published."}`);
          }
          published += 1;
          URL.revokeObjectURL(item.preview);
          setFiles((current) => current.filter((entry) => entry.id !== item.id));
        } catch (err) {
          failed += 1;
          setFiles((current) => current.map((entry) => entry.id === item.id
            ? { ...entry, status: "error", error: err.message || "Upload failed." }
            : entry));
        } finally {
          setProgress((current) => current ? { ...current, completed: current.completed + 1 } : current);
        }
      }
      if (published) {
        if (!failed) setDescription("");
        setNotice(`${published} ${published === 1 ? "story" : "stories"} published. ${failed ? `${failed} failed and can be retried.` : "They will expire automatically after 24 hours."}`);
      }
      if (failed && !published) setError(`Upload failed for all ${failed} ${failed === 1 ? "photo" : "photos"}. Review the message on each photo, then retry.`);
      if (published) await load({ clearFeedback: false });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function removeSelected(item) {
    URL.revokeObjectURL(item.preview);
    setFiles((current) => current.filter((entry) => entry.id !== item.id));
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
  const atCapacity = remainingSlots === 0;

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
          <Metric label="Upload limit" value={`${maxMb || 10} MB each`} hint="JPEG, PNG, WebP or iPhone HEIC" />
        </section>

        {error && <div className={ui.errorBanner} role="alert">{error}</div>}
        {notice && <div className={styles.successBanner} role="status">{notice}</div>}
        {progress && (
          <div className={styles.progressBanner} role="status" aria-live="polite">
            Publishing {Math.min(progress.completed + 1, progress.total)} of {progress.total} photos…
          </div>
        )}

        <section className={styles.workspace}>
          <form className={styles.uploadPanel} onSubmit={uploadStory}>
            <div className={styles.panelHeading}>
              <ImagePlus size={18} aria-hidden="true" />
              <div><h2>New stories</h2><p>Select multiple photos. iPhone HEIC images are converted privately in your browser before upload.</p></div>
            </div>

            <label className={styles.dropzone}>
              <UploadCloud size={32} aria-hidden="true" />
              <span>{files.length ? "Add more photos" : "Choose photos"}</span>
              <small>JPEG, PNG, WebP or HEIC · up to {maxMb || 10} MB each · {Math.max(0, remainingSlots - files.length)} slots available</small>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                disabled={uploading || atCapacity || files.length >= remainingSlots}
                onChange={selectPhotos}
              />
            </label>

            {files.length > 0 && (
              <div className={styles.selection} aria-label="Selected story photos">
                <div className={styles.selectionSummary}>
                  <strong>{files.length} selected</strong>
                  <span>{formatBytes(selectedBytes)} total</span>
                </div>
                <div className={styles.selectionGrid}>
                  {files.map((item, index) => (
                    <article className={`${styles.selectedItem} ${item.status === "error" ? styles.selectedItemError : ""}`} key={item.id}>
                      <img src={item.preview} alt={`Selected story ${index + 1}`} />
                      <span className={styles.order}>{String(index + 1).padStart(2, "0")}</span>
                      <button type="button" onClick={() => removeSelected(item)} disabled={uploading} aria-label={`Remove ${item.originalName}`} title="Remove photo">
                        <X size={14} />
                      </button>
                      <div className={styles.selectedMeta}>
                        <strong>{item.originalName}</strong>
                        <small>{item.status === "uploading" ? "Publishing…" : item.status === "error" ? `Failed · ${item.error}` : item.converted ? "HEIC → JPEG · Ready" : `${item.contentType.replace("image/", "").toUpperCase()} · Ready`}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

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

            <button type="submit" className={ui.buttonPrimary} disabled={!files.length || uploading || atCapacity}>
              <UploadCloud size={15} /> {uploading ? "Publishing stories…" : atCapacity ? "Story limit reached" : files.length ? `Publish ${files.length} ${files.length === 1 ? "story" : "stories"}` : "Publish stories"}
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
