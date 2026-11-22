export const SHARE_EVENT = 'yuqi:share';

export function openShare(content) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: content }));
}

export function cardShareContent(profile, url = '/card') {
  const role = [profile.title, profile.company].filter(Boolean).join(' at ');
  return { kind: 'card', heading: 'Share my card', label: 'Contact card', title: profile.name,
    text: role, source: 'yuqi.site/card', url, role, image: profile.photo };
}
