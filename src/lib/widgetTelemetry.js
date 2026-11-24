import { trackBehavior } from './behaviorAnalytics';

const recent = new Map();
const ACTIONS = new Set(['open', 'close', 'link_copied', 'image_download_requested', 'qr_download_requested', 'expand_services', 'collapse_services',
  'answer_liked', 'answer_disliked', 'answer_rating_cleared']);
export function trackWidget(component, action = 'open') {
  if (!['chat', 'search', 'share', 'monitoring', 'workflow'].includes(component) || !ACTIONS.has(action)) return;
  const key = `${component}:${action}`, now = Date.now(), previous = recent.get(key);
  if (previous && now - previous < 1000) return;
  if (trackBehavior(action === 'open' ? 'widget_opened' : 'widget_action',
    { properties: { component, action: String(action).slice(0, 40) } })) recent.set(key, now);
}
