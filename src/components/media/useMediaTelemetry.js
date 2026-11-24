import { useEffect, useRef } from 'react';
import { trackBehavior } from '../../lib/behaviorAnalytics';
import { createMediaTelemetry, mediaContext, observeMedia } from '../../lib/media/telemetry.mjs';
import { observeTelemetryVisibility } from '../../lib/media/telemetryVisibility.mjs';
import { mediaNetworkProperties } from '../../lib/media/playbackStats.mjs';

export default function useMediaTelemetry({ asset, frame, video, active, placement = 'article', preview = false, emit = trackBehavior }) {
  const controller = useRef(null), attachedVideo = useRef(null);
  useEffect(() => {
    if (!asset) return undefined;
    const context = mediaContext(asset, placement, window.location.pathname);
    let exposure;
    const tracker = createMediaTelemetry({ emit, context, preview, network: mediaNetworkProperties,
      visible: () => exposure?.visible() || (video.current && document.pictureInPictureElement === video.current) });
    controller.current = tracker;
    exposure = observeTelemetryVisibility(frame.current, {
      key: JSON.stringify([context.page, context.properties.mediaId, context.properties.mediaVersion, placement]),
      impression: () => { try { return emit('media_impression', context); } catch { return false; } },
      boundary: () => { if (video.current) tracker.boundary(video.current, true); },
    });
    return () => { exposure.unregister(); tracker.dispose(attachedVideo.current); controller.current = null; };
    // Stable identity avoids resetting a play when the parent rerenders its asset object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.assetId, asset?.version, placement, preview, emit]);
  useEffect(() => {
    if (!active || !video.current || !controller.current) return undefined;
    const tracker = controller.current, element = video.current;
    attachedVideo.current = element;
    const detach = observeMedia(element, tracker);
    if (!element.paused && element.readyState >= 2) tracker.playing(element);
    return () => { detach(); tracker.boundary(element, true); if (preview) tracker.finishPreview(); attachedVideo.current = null; };
  }, [active, asset?.id, asset?.assetId, asset?.version, placement, preview, video, emit]);
  return controller;
}
