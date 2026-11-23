// Resolves the media references in an article against the published read model.
//
// Works with any Supabase client: the server one in getServerSideProps, the browser one on pages
// that render on the client. `media_public` exposes READY assets, not article publication state.
import { hydrateMedia, mediaIds } from './markup.mjs';

/** Rendering switches, from the environment. All optional. */
export function mediaOptions() {
  return {
    // Where the public bucket is served from, e.g. https://storage.googleapis.com/<bucket>
    baseUrl: process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '',
    // 720 = leave out the 1080p rendition. The first step when bandwidth has to be saved.
    maxHeight: Number(process.env.NEXT_PUBLIC_MEDIA_MAX_HEIGHT) || 0,
    // "off" = posters only. The second step.
    video: process.env.NEXT_PUBLIC_MEDIA_VIDEO !== 'off',
  };
}

/**
 * Returns `html` with every published asset turned into a player or a responsive image.
 * Never throws: if the lookup fails, the article is shown with its stored preview images.
 */
export async function renderMedia(html, supabase, options = mediaOptions()) {
  const ids = mediaIds(html).slice(0, 50);
  if (ids.length === 0 || !options.baseUrl || !supabase) return html || '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const { data, error } = await supabase.from('media_public').select('id,kind,manifest').in('id', ids)
      .abortSignal(controller.signal);
    if (error || !Array.isArray(data)) return html;
    const assets = new Map(data.map(row => [String(row.id).toLowerCase(), row]));
    return hydrateMedia(html, assets, options);
  } catch {
    return html;
  } finally {
    clearTimeout(timeout);
  }
}
