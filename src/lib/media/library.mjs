import { assetUrl } from './markup.mjs';

export function mediaPoster(asset, baseUrl) {
  if (asset?.previewUrl) return asset.previewUrl;
  const file = asset?.manifest?.poster || asset?.manifest?.fallback;
  return file && baseUrl ? assetUrl(baseUrl, asset.manifest, file.path) : '';
}

export function mediaFacts(asset) {
  const source = asset.probe || asset.manifest || asset.previewDemo || {};
  return {
    width: Number(source.width) || 0, height: Number(source.height) || 0,
    seconds: Number(source.durationSeconds ?? source.seconds) || 0,
    codec: source.videoCodec || source.codec || '',
  };
}

export function mediaSteps(asset) {
  const jobs = asset.jobs || [];
  const state = job => job?.status === 'SUCCEEDED' ? 'done' : job?.status === 'RUNNING' ? 'active'
    : job?.status === 'DEAD' ? 'failed' : 'waiting';
  if (asset.status === 'LOCAL') return [];
  const plan = jobs.find(job => job.type === 'PLAN');
  const outputs = jobs.filter(job => !['PLAN', 'PUBLISH'].includes(job.type));
  const publish = jobs.find(job => job.type === 'PUBLISH');
  const ready = asset.status === 'READY';
  return [
    { title: 'Uploaded', state: asset.sourceVersion > 0 || ready ? 'done' : asset.status === 'FAILED' ? 'failed' : 'active', detail: 'Original stored privately' },
    { title: 'Probed', state: ready || asset.probe ? 'done' : state(plan), detail: 'Source dimensions and encoding checked', jobs: plan ? [plan] : [] },
    { title: asset.kind === 'VIDEO' ? 'Transcoding' : 'Image variants', state: ready || outputs.length && outputs.every(job => job.status === 'SUCCEEDED') ? 'done'
      : outputs.some(job => job.status === 'DEAD') ? 'failed' : outputs.some(job => job.status === 'RUNNING') ? 'active' : 'waiting', jobs: outputs },
    { title: 'Validate & publish', state: ready ? 'done' : state(publish), detail: ready ? 'Processed files verified and available' : 'Verify every output before making it available', jobs: publish ? [publish] : [] },
  ];
}

export function mediaRenditions(asset) {
  if (asset.previewDemo) return (asset.previewDemo.qualities || []).map(q => ({ name: `${q.height}p`, status: 'LOCAL', bytes: q.bytes }));
  if (asset.status === 'READY') return (asset.manifest?.renditions || asset.manifest?.variants || []).map(r => ({
    name: r.name || `${r.width}px ${r.format}`, status: 'SUCCEEDED', bytes: r.bytes,
  }));
  return (asset.jobs || []).filter(j => ['VIDEO_RENDITION', 'IMAGE_VARIANTS'].includes(j.type)).map(j => ({ name: j.rendition, status: j.status }));
}

export function mediaWarnings(asset) {
  const { width } = mediaFacts(asset);
  if (!width) return [];
  return (asset.usages || []).filter(use => Number(use.displayWidth) > width).map(use =>
    `Source is ${(Number(use.displayWidth) / width).toFixed(1)}x smaller than ${use.label}.`);
}

export function savedUpload(session) {
  // Never persist signed PUT URLs; re-issue them through the authenticated resume endpoint.
  return { assetId: session.assetId, uploadId: session.uploadId, expiresAt: session.expiresAt, fileIdentity: session.fileIdentity };
}
