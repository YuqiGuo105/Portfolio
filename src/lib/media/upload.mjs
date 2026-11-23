// Uploads one file through the media pipeline: ask for an upload, send the parts straight to the
// bucket, confirm. `api` is writerApi.media; it is a parameter so the tests can stand in for it.
//
// The bytes never pass through the Content Service. Each part goes to its own signed URL, a few
// at a time, and a part that fails is retried on its own. If the tab is closed half way, the same
// file can be continued later with `resume`.

const RETRIES = 3;

const fileIdentity = file => ({ name: file.name || 'upload', size: file.size, type: file.type, lastModified: file.lastModified || 0 });

function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
}

/**
 * @param {File|Blob} file
 * @param {{ api: object, title?: string, concurrency?: number, signal?: AbortSignal,
 *           onProgress?: (fraction: number) => void, onSession?: (session: object) => void,
 *           resume?: { assetId: string, uploadId: string }, fetchImpl?: typeof fetch,
 *           wait?: (ms: number) => Promise<void> }} options
 * @returns the asset as the API reports it after confirmation (status PROCESSING)
 */
export async function uploadMedia(file, options) {
  const { api, title, concurrency = 3, signal, onProgress = () => {}, onSession = () => {}, resume } = options;
  const fetchImpl = options.fetchImpl || fetch;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  checkCancelled(signal);
  const identity = fileIdentity(file);
  if (resume && (!resume.fileIdentity || Object.keys(identity).some(key => resume.fileIdentity[key] !== identity[key]))) {
    throw new Error('Resume requires the original file. Select it again or start a new upload.');
  }

  const session = resume
    ? await api.resume(resume.assetId, resume.uploadId)
    : await api.start({ filename: file.name || 'upload', contentType: file.type, sizeBytes: file.size, title });
  checkCancelled(signal);
  if (session.sizeBytes !== file.size || session.contentType !== file.type
      || !Number.isSafeInteger(session.partSizeBytes) || session.partSizeBytes <= 0
      || session.partCount !== Math.ceil(file.size / session.partSizeBytes)
      || !Array.isArray(session.parts) || session.parts.length !== session.partCount
      || new Set(session.parts.map(part => part.partNumber)).size !== session.partCount
      || session.parts.some(part => !Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > session.partCount)) {
    throw new Error('The upload session does not match this file. Start a new upload.');
  }
  onSession({ ...session, fileIdentity: identity });

  const done = new Set(session.uploadedParts || []);
  if ([...done].some(number => !Number.isInteger(number) || number < 1 || number > session.partCount)) {
    throw new Error('Invalid uploaded parts in the upload session');
  }
  const pending = session.parts.filter(part => !done.has(part.partNumber));
  const sizeOf = partNumber => Math.min(session.partSizeBytes, file.size - (partNumber - 1) * session.partSizeBytes);
  let sent = [...done].reduce((total, partNumber) => total + sizeOf(partNumber), 0);
  onProgress(file.size ? sent / file.size : 1);

  const putPart = async part => {
    const start = (part.partNumber - 1) * session.partSizeBytes;
    const body = file.slice(start, start + sizeOf(part.partNumber));
    for (let attempt = 1; ; attempt++) {
      checkCancelled(cancellation.signal);
      try {
        const response = await fetchImpl(part.url, { method: 'PUT', body, signal: cancellation.signal });
        if (response.ok) break;
        // The signed URL expired or was refused: retrying the same URL cannot help.
        if (response.status === 403 || response.status === 404) throw Object.assign(new Error(`Part ${part.partNumber} was refused (${response.status})`), { final: true });
        throw new Error(`Part ${part.partNumber} failed (${response.status})`);
      } catch (error) {
        if (error.name === 'AbortError' || error.final || attempt >= RETRIES) throw error;
        await wait(500 * 2 ** (attempt - 1));
      }
    }
    sent += sizeOf(part.partNumber);
    onProgress(sent / file.size);
  };

  const queue = [...pending];
  const cancellation = new AbortController();
  const abort = () => cancellation.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let failure;
  const worker = async () => {
    try {
      for (let part = queue.shift(); part && !failure; part = queue.shift()) await putPart(part);
    } catch (error) {
      failure ||= error;
      cancellation.abort();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(6, Math.floor(concurrency) || 1, pending.length)) }, worker));
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  if (failure) throw failure;
  checkCancelled(signal);
  return api.complete(session.assetId, session.uploadId);
}

/**
 * Polls until the asset is READY or FAILED. Processing a video takes from seconds to minutes.
 * @returns the final asset
 */
export async function waitUntilProcessed(api, assetId, { onUpdate = () => {}, intervalMs = 2000, timeoutMs = 30 * 60 * 1000, signal, wait } = {}) {
  const pause = wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const asset = await api.get(assetId);
    onUpdate(asset);
    if (asset.status === 'READY' || asset.status === 'FAILED') return asset;
    if (Date.now() > deadline) throw new Error('Processing is taking longer than expected; check the media library later.');
    await pause(intervalMs);
  }
}

/** "3 of 5 steps" for a status line: how many of the asset's jobs are finished. */
export function processingProgress(asset) {
  const jobs = Array.isArray(asset?.jobs) ? asset.jobs : [];
  return { done: jobs.filter(job => job.status === 'SUCCEEDED').length, total: jobs.length };
}
