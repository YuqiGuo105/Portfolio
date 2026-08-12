import { randomUUID } from "crypto";
import { supabaseServer } from "../supabase/supabaseServer";

const BUCKET = process.env.STORY_STORAGE_BUCKET || "portfolio-stories";
const ITEM_PREFIX = "items";
const META_PREFIX = "_meta";
const TTL_SECONDS = Number(process.env.STORY_TTL_SECONDS || 86400);
const READ_URL_TTL_SECONDS = Number(process.env.STORY_READ_URL_TTL_SECONDS || 3600);
const MAX_STORIES = Number(process.env.STORY_MAX_ACTIVE || 10);
const MAX_BYTES = Number(process.env.STORY_MAX_BYTES || 10 * 1024 * 1024);
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const BUCKET_MIME_TYPES = [...ALLOWED_TYPES.keys(), "application/json"];

let bucketReady;

export function storyStorageConfig() {
  return { bucket: BUCKET, maxBytes: MAX_BYTES, maxStories: MAX_STORIES, ttlSeconds: TTL_SECONDS };
}

export function validateStoryInput({ contentType, size, description = "" }) {
  const extension = ALLOWED_TYPES.get(String(contentType || "").toLowerCase());
  if (!extension) throw httpError(400, "Use a JPEG, PNG or WebP image.");
  if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > MAX_BYTES) {
    throw httpError(400, `Image size must be between 1 byte and ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`);
  }
  if (String(description).trim().length > 160) throw httpError(400, "Description must be 160 characters or fewer.");
  return { extension, description: String(description).trim() };
}

export async function ensureStoryBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data, error } = await supabaseServer.storage.getBucket(BUCKET);
      if (data && !error) {
        const configuredTypes = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
        const needsPolicyUpdate = BUCKET_MIME_TYPES.some((type) => !configuredTypes.includes(type));
        if (!needsPolicyUpdate) return;

        const updated = await supabaseServer.storage.updateBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_BYTES,
          allowedMimeTypes: BUCKET_MIME_TYPES,
        });
        if (updated.error) throw updated.error;
        return;
      }
      const created = await supabaseServer.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: BUCKET_MIME_TYPES,
      });
      if (created.error && !String(created.error.message || "").toLowerCase().includes("already exists")) {
        throw created.error;
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  await bucketReady;
}

export async function prepareStoryUpload(input) {
  await ensureStoryBucket();
  const { extension, description } = validateStoryInput(input);
  const active = await listStoryMetadata({ includeExpired: false });
  if (active.length >= MAX_STORIES) throw httpError(409, `A maximum of ${MAX_STORIES} active stories is allowed.`);

  const id = randomUUID();
  const path = `${ITEM_PREFIX}/${id}.${extension}`;
  const { data, error } = await supabaseServer.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw error || new Error("Supabase did not return a signed upload URL.");
  return { id, path, signedUrl: data.signedUrl, bucket: BUCKET, description };
}

export async function finalizeStory({ id, path, contentType, size, description, actor }) {
  await ensureStoryBucket();
  const validated = validateStoryInput({ contentType, size, description });
  validateStoryId(id);
  if (!isOwnedPath(id, path) || !path.endsWith(`.${validated.extension}`)) {
    throw httpError(400, "Invalid story upload path.");
  }

  const active = await listStoryMetadata({ includeExpired: false });
  if (!active.some((story) => story.id === id) && active.length >= MAX_STORIES) {
    await supabaseServer.storage.from(BUCKET).remove([path]);
    throw httpError(409, `A maximum of ${MAX_STORIES} active stories is allowed.`);
  }

  const filename = path.split("/").pop();
  const { data: files, error: listError } = await supabaseServer.storage
    .from(BUCKET)
    .list(ITEM_PREFIX, { limit: 5, search: filename });
  if (listError) throw listError;
  const storedFile = files?.find((file) => file.name === filename);
  if (!storedFile) throw httpError(409, "Upload has not completed yet.");
  if (Number(storedFile.metadata?.size || storedFile.size || 0) > MAX_BYTES) {
    await supabaseServer.storage.from(BUCKET).remove([path]);
    throw httpError(400, "Uploaded image exceeds the configured size limit.");
  }
  const storedType = String(storedFile.metadata?.mimetype || storedFile.metadata?.contentType || "").toLowerCase();
  if (storedType && storedType !== String(contentType).toLowerCase()) {
    await supabaseServer.storage.from(BUCKET).remove([path]);
    throw httpError(400, "Uploaded image type does not match the declared content type.");
  }

  const now = new Date();
  const metadata = {
    id,
    path,
    description: validated.description,
    contentType: String(contentType).toLowerCase(),
    size: Number(size),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),
    createdBy: actor || "admin",
    schemaVersion: 1,
  };
  const { error } = await supabaseServer.storage
    .from(BUCKET)
    .upload(metaPath(id), Buffer.from(JSON.stringify(metadata)), {
      contentType: "application/json",
      upsert: false,
    });
  if (error) throw error;
  return metadata;
}

export async function listStories({ includeExpired = false, cleanup = true } = {}) {
  await ensureStoryBucket();
  const metadata = await listStoryMetadata({ includeExpired: true });
  const now = Date.now();
  const expired = metadata.filter((item) => Date.parse(item.expiresAt) <= now);
  if (cleanup && expired.length) await removeStories(expired).catch(() => {});
  const visible = includeExpired ? metadata : metadata.filter((item) => Date.parse(item.expiresAt) > now);
  const paths = visible.map((item) => item.path);
  if (!paths.length) return [];
  const { data: signed, error } = await supabaseServer.storage.from(BUCKET).createSignedUrls(paths, READ_URL_TTL_SECONDS);
  if (error) throw error;
  const urlByPath = new Map((signed || []).map((entry) => [entry.path, entry.signedUrl]));
  return visible
    .map((item) => ({ ...item, url: urlByPath.get(item.path) || null }))
    .filter((item) => item.url)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function deleteStory(id) {
  await ensureStoryBucket();
  validateStoryId(id);
  const metadata = await readMetadata(id);
  const paths = [metaPath(id)];
  if (metadata?.path && isOwnedPath(id, metadata.path)) paths.push(metadata.path);
  const { error } = await supabaseServer.storage.from(BUCKET).remove(paths);
  if (error) throw error;
  return Boolean(metadata);
}

export async function cleanupExpiredStories() {
  await ensureStoryBucket();
  const all = await listStoryMetadata({ includeExpired: true });
  const now = Date.now();
  const expired = all.filter((item) => Date.parse(item.expiresAt) <= now);
  const removed = await removeStories(expired);
  const referenced = new Set(all.filter((item) => Date.parse(item.expiresAt) > now).map((item) => item.path));
  const { data: files, error } = await supabaseServer.storage.from(BUCKET).list(ITEM_PREFIX, { limit: 100 });
  if (error) throw error;
  const orphanCutoff = now - 2 * 60 * 60 * 1000;
  const orphans = (files || [])
    .filter((file) => !referenced.has(`${ITEM_PREFIX}/${file.name}`))
    .filter((file) => Date.parse(file.created_at || file.updated_at || 0) < orphanCutoff)
    .map((file) => `${ITEM_PREFIX}/${file.name}`);
  if (orphans.length) await supabaseServer.storage.from(BUCKET).remove(orphans);
  return { expiredRemoved: removed, orphanedUploadsRemoved: orphans.length };
}

async function listStoryMetadata({ includeExpired }) {
  const { data: files, error } = await supabaseServer.storage.from(BUCKET).list(META_PREFIX, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw error;
  const records = (await Promise.all((files || []).filter((file) => file.name.endsWith(".json")).map((file) => readMetadata(file.name.replace(/\.json$/, "")))))
    .filter(Boolean)
    .filter(validMetadata);
  if (includeExpired) return records;
  const now = Date.now();
  return records.filter((item) => Date.parse(item.expiresAt) > now);
}

async function readMetadata(id) {
  const { data, error } = await supabaseServer.storage.from(BUCKET).download(metaPath(id));
  if (error) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function removeStories(stories) {
  const paths = stories.flatMap((item) => [metaPath(item.id), item.path]).filter(Boolean);
  if (!paths.length) return 0;
  const { error } = await supabaseServer.storage.from(BUCKET).remove(paths);
  if (error) throw error;
  return stories.length;
}

function validMetadata(item) {
  return item && typeof item.id === "string" && isOwnedPath(item.id, item.path) && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.expiresAt));
}

function isOwnedPath(id, path) {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && typeof path === "string" && path.startsWith(`${ITEM_PREFIX}/${id}.`) && !path.includes("..");
}

function metaPath(id) {
  return `${META_PREFIX}/${id}.json`;
}

function validateStoryId(id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw httpError(400, "Invalid story ID.");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
