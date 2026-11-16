// Résumé files: a private Supabase Storage bucket. The browser uploads straight to it with a
// short-lived signed URL, so a 2 MB file never travels through a serverless function, and the
// bucket itself refuses anything that is not a PDF of 2 MB or less. Only the server reads it back:
// the worker (to check and screen the file) and the owner (through a one-minute download link).
import { randomBytes } from 'node:crypto';
import { RESUME_MAX_BYTES } from './config.mjs';

export const RESUME_BUCKET = 'referral-resumes';
export const resumePath = id => `${id}/${randomBytes(12).toString('hex')}.pdf`;

export function supabaseResumeStorage(client, bucket = RESUME_BUCKET) {
  let ready;
  const files = () => client.storage.from(bucket);
  // Created on first use with the size and type limits, the way the stories bucket is.
  const ensure = () => (ready ||= (async () => {
    const options = { public: false, fileSizeLimit: RESUME_MAX_BYTES, allowedMimeTypes: ['application/pdf'] };
    const existing = await client.storage.getBucket(bucket);
    if (existing.data && !existing.error) {
      const current = existing.data;
      if (current.public || current.file_size_limit !== RESUME_MAX_BYTES || (current.allowed_mime_types || []).join() !== 'application/pdf') {
        const updated = await client.storage.updateBucket(bucket, options);
        if (updated.error) throw new Error('Résumé storage unavailable');
      }
      return;
    }
    const created = await client.storage.createBucket(bucket, options);
    if (created.error && !/already exists/i.test(created.error.message || '')) throw new Error('Résumé storage unavailable');
  })().catch(error => { ready = null; throw error; }));
  return {
    // A URL the browser can PUT one file to. It cannot overwrite, list or read anything.
    async createUpload(path) {
      await ensure();
      const { data, error } = await files().createSignedUploadUrl(path);
      if (error || !data?.signedUrl) throw new Error('Résumé storage unavailable');
      return { url: data.signedUrl };
    },
    // { size, contentType } once the upload has landed, otherwise null.
    async stat(path) {
      const [folder, name] = path.split('/');
      const { data, error } = await files().list(folder, { limit: 1, search: name });
      if (error) throw new Error('Résumé storage unavailable');
      const found = (data || []).find(item => item.name === name);
      return found ? { size: Number(found.metadata?.size) || 0, contentType: found.metadata?.mimetype || '' } : null;
    },
    async download(path) {
      const { data, error } = await files().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(paths) {
      const list = paths.filter(Boolean);
      if (!list.length) return 0;
      const { error } = await files().remove(list);
      if (error) throw new Error('Résumé storage unavailable');
      return list.length;
    },
    // A link that downloads the file under its original name and stops working after `seconds`.
    async downloadUrl(path, filename, seconds = 60) {
      const { data, error } = await files().createSignedUrl(path, seconds, { download: filename });
      if (error || !data?.signedUrl) throw new Error('Résumé storage unavailable');
      return data.signedUrl;
    },
  };
}

// Local preview and tests: files in memory behind the same interface. `uploadBase` is the local
// route that stands in for the signed upload URL.
export function memoryResumeStorage({ uploadBase = '/api/referral/preview-upload' } = {}) {
  const objects = new Map(), tickets = new Map();
  return {
    objects,
    async createUpload(path) {
      const token = randomBytes(16).toString('hex');
      tickets.set(token, path);
      return { url: `${uploadBase}?token=${token}` };
    },
    // What the stand-in route calls when the browser PUTs the file.
    put(token, bytes, contentType) {
      const path = tickets.get(token);
      if (!path) return { status: 403, error: 'This upload link is not valid.' };
      if (contentType !== 'application/pdf') return { status: 415, error: 'Only PDF files are accepted.' };
      if (bytes.length > RESUME_MAX_BYTES) return { status: 413, error: 'The file is larger than 2 MB.' };
      if (objects.has(path)) return { status: 409, error: 'The resource already exists' };
      objects.set(path, { bytes, contentType });
      return { status: 200 };
    },
    async stat(path) { const found = objects.get(path); return found ? { size: found.bytes.length, contentType: found.contentType } : null; },
    async download(path) { return objects.get(path)?.bytes || null; },
    async remove(paths) { let count = 0; for (const path of paths.filter(Boolean)) if (objects.delete(path)) count += 1; return count; },
    async downloadUrl(path, filename) { return `/api/referral/preview-upload?file=${encodeURIComponent(path)}&name=${encodeURIComponent(filename)}`; },
  };
}
