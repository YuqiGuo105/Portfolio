import { localDemos, localIntro } from './demoCatalog.mjs';

const publicPath = (value, base) => {
  if (typeof value !== 'string' || !/^media\/[a-zA-Z0-9/_ .-]+$/.test(value)
      || value.split('/').some(part => !part || part === '..' || part === '.')) return null;
  return `${base}/${value.split('/').map(encodeURIComponent).join('/')}`;
};

export function publishedDemo(row, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || !row?.manifest || !row?.presentation) return null;
  let p = row.presentation;
  let hls;
  if (p.version === 2 && p.playback === 'asset') {
    if (row.placement_key !== 'yuqi-intro' || p.id !== row.placement_key) return null;
    const m = row.manifest;
    const path = value => typeof value === 'string' ? `${m.basePath}/${value}` : null;
    hls = publicPath(path(m.hls), base);
    if (!hls || !hls.endsWith('.m3u8') || !Number.isFinite(m.durationSeconds) || m.durationSeconds <= 0) return null;
    const qualities = (Array.isArray(m.renditions) ? m.renditions : []).map(r => ({
      height: Math.min(Number(r.width), Number(r.height)), src: path(r.playlist),
    })).filter(r => r.height > 0 && publicPath(r.src, base)?.endsWith('.m3u8'));
    if (!qualities.length) return null;
    // The MP4 in a processed manifest is only a short hover loop. Full playback uses HLS.
    p = { ...p, src: path(m.hls), poster: path(m.poster?.path), seconds: m.durationSeconds,
      width: m.width, height: m.height, qualities };
  }
  const src = publicPath(p.src, base);
  const poster = publicPath(p.poster, base);
  if (!src || !poster || !p.id || !(Number(p.seconds) > 0)) return null;
  const qualities = (p.qualities || []).filter(q => hls
    ? Number.isInteger(q.height) && q.height > 0
    : [360, 480, 720, 1080].includes(q.height))
    .map(q => ({ height: q.height, src: publicPath(q.src, base), bytes: Number(q.bytes) || 0 })).filter(q => q.src);
  const href = /^\/(?:work-single|blog-single)\/[a-f0-9-]+$/.test(p.href || '') ? p.href : null;
  if (p.id !== 'yuqi-intro' && (!href || !/^(?:project|blog):[a-f0-9-]+$/.test(p.contentId || ''))) return null;
  return { id: String(p.id), title: String(p.title || ''), summary: String(p.summary || ''),
    contentId: p.contentId || null, href, src, poster, seconds: Number(p.seconds), ...(hls ? { hls } : {}),
    width: Number(p.width) || 0, height: Number(p.height) || 0, bytes: Number(p.bytes) || 0,
    preview: publicPath(p.preview, base), captions: publicPath(p.captions, base), qualities,
    chapters: (p.chapters || []).slice(0, 30).filter(c => Number.isFinite(c.seconds) && c.seconds >= 0 && c.seconds < p.seconds)
      .map(c => ({ seconds: c.seconds, title: String(c.title || '').slice(0, 120),
        ...(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(c.href || '') ? { href: c.href } : {}) })),
  };
}

// Called during SSR/ISR only. A failed catalog must never block the article or homepage.
export async function loadMediaCatalog(client, env = process.env) {
  const local = localDemos(env);
  if (local.length) return { demos: local, intro: localIntro(env) };
  if (!client || !env.NEXT_PUBLIC_MEDIA_BASE_URL) return { demos: [], intro: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const { data, error } = await client.from('media_demo_catalog').select('placement_key,asset_id,presentation,manifest')
      .order('placement_key').limit(50).abortSignal(controller.signal);
    const all = error || !Array.isArray(data) ? [] : data.map(row => publishedDemo(row, env.NEXT_PUBLIC_MEDIA_BASE_URL)).filter(Boolean);
    return { demos: all.filter(demo => demo.id !== 'yuqi-intro'), intro: all.find(demo => demo.id === 'yuqi-intro') || null };
  } catch { return { demos: [], intro: null }; }
  finally { clearTimeout(timeout); }
}
