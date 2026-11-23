export const validJobId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const pendingPresentationJob = job => ['WAITING_UPLOAD', 'WAITING_MEDIA'].includes(job?.status);
export const canUploadPresentation = job => pendingPresentationJob(job)
  && (!job.assetId || job.assetStatus === 'UPLOADING') && Date.parse(job.expiresAt) > Date.now();

export function presentationJobLabel(job) {
  if (!job) return 'No upload selected';
  if (pendingPresentationJob(job) && Date.parse(job.expiresAt) <= Date.now()) return 'Request expired';
  if (job.status === 'WAITING_MEDIA') return job.assetStatus === 'UPLOADING' ? 'Awaiting file upload'
    : job.assetStatus === 'READY' ? 'Ready to replace Introduction' : 'Processing video';
  return ({ WAITING_UPLOAD: 'Choose a video', SUCCEEDED: 'Introduction replaced', FAILED: 'Replacement failed',
    CONFLICT: 'Introduction changed', CANCELLED: 'Request cancelled', EXPIRED: 'Request expired' })[job.status] || 'Checking status';
}

export function presentationJobMessage(job) {
  if (job?.errorCode === 'administrator_access_revoked') return 'Administrator access changed. The current Introduction was not replaced.';
  if (job?.status === 'CONFLICT') return 'Someone changed the Introduction after this request was created. The newer version was kept.';
  if (job?.status === 'FAILED') return 'The video could not be published. The current Introduction was kept.';
  if (job?.status === 'SUCCEEDED') return 'The replacement is saved. The homepage may take up to five minutes and a fresh request to refresh. The previous video remains in the media library.';
  if (job?.status === 'CANCELLED') return 'This request will not replace the Introduction. Any uploaded asset is retained.';
  if (job?.status === 'EXPIRED') return 'This request has expired. Create a new request to replace the Introduction.';
  return '';
}

// The browser, not the external AI sandbox, uploads bytes using the existing signed-part client.
export function presentationUploadApi(api, jobId) {
  if (!validJobId(jobId)) throw new Error('Invalid upload request');
  return { start: body => api.uploadPresentationJob(jobId, body), complete: api.complete, resume: api.resume };
}
