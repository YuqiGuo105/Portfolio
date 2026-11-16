// What is waiting for the owner, gathered from admin APIs that already exist. Each source is
// optional: one that fails or is switched off is reported as "could not check", never as an error
// for the whole bell.
const when = value => { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; };
const rows = value => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.failures) ? value.failures : []);
const text = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// `load(api)` calls one admin endpoint; `items(data)` turns its answer into notifications.
export const SOURCES = [
  { id: 'audience', label: 'Audience alerts', href: '/admin/visitors', load: api => api.alerts(),
    items: data => rows(data?.incidents).map(row => ({
      key: `audience:${row.incidentId ?? row.id}`, title: text(row.ruleName) || 'Visitor alert', at: when(row.createdAt),
      detail: row.measuredValue !== undefined && row.threshold !== undefined ? `Measured ${row.measuredValue}, threshold ${row.threshold}` : '',
    })) },
  { id: 'referrals', label: 'Referral requests', href: '/admin/referrals', load: api => api.referrals(),
    items: data => rows(data?.requests).filter(row => row.status === 'new').map(row => ({
      key: `referral:${row.id}`, title: text(row.name) || 'New request', at: when(row.created_at),
      detail: [text(row.role_title), text(row.company)].filter(Boolean).join(' at '),
    })) },
  { id: 'flags', label: 'Globe flags to review', href: '/admin/globe-flags', load: api => api.flags(),
    items: data => rows(data?.flags).map(row => ({
      key: `flag:${row.id}`, title: [text(row.emoji, 8), text(row.message, 80)].filter(Boolean).join(' ') || 'New flag', at: when(row.created_at),
      detail: [text(row.city), text(row.country)].filter(Boolean).join(', '),
    })) },
  { id: 'reviews', label: 'Submissions to review', href: '/admin/discovery', load: api => api.reviews(),
    items: data => rows(data?.reviews).filter(row => !row.status || row.status === 'pending').map(row => ({
      key: `review:${row.id}`, title: text(row.title || row.summary || row.kind) || 'Submission', at: when(row.created_at || row.createdAt), detail: text(row.source || row.kind, 60),
    })) },
  { id: 'monitoring', label: 'Monitoring', href: '/admin/jobs', load: api => api.failures(),
    items: data => rows(data).map(row => ({
      key: `failure:${row.kind ?? row.type ?? 'job'}:${row.id ?? row.eventId ?? row.jobId}`, title: `Failed: ${text(row.kind || row.type || row.jobType || 'background job', 60).toLowerCase().replace(/_/g, ' ')}`,
      at: when(row.failedAt || row.updatedAt || row.createdAt || row.created_at), detail: text(row.lastError || row.error || row.message, 100),
    })) },
];

// Runs every source side by side. Returns { groups: [{ id, label, href, items }], items, unchecked: [labels] }.
export async function gatherNotifications(api, sources = SOURCES) {
  const settled = await Promise.allSettled(sources.map(source => Promise.resolve().then(() => source.load(api))));
  const groups = [], unchecked = [];
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status !== 'fulfilled') { unchecked.push(source.label); return; }
    let items = [];
    try { items = source.items(result.value).filter(item => item.key && !item.key.endsWith(':undefined')); } catch { unchecked.push(source.label); return; }
    items.sort((a, b) => b.at - a.at);
    if (items.length) groups.push({ id: source.id, label: source.label, href: source.href, items: items.slice(0, 8), more: Math.max(0, items.length - 8), total: items.length });
  });
  groups.sort((a, b) => (b.items[0]?.at || 0) - (a.items[0]?.at || 0));
  return { groups, unchecked, keys: groups.flatMap(group => group.items.map(item => item.key)), total: groups.reduce((sum, group) => sum + group.total, 0) };
}

// The badge counts what has not been looked at yet; opening the list marks everything shown as seen.
export const unseenCount = (keys, seen) => { const known = new Set(seen); return keys.filter(key => !known.has(key)).length; };
export const rememberSeen = (keys, seen, cap = 400) => [...new Set([...keys, ...seen])].slice(0, cap);

export function ago(at, now = Date.now()) {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

// "Yuqi Guo" → "YG"; an email address → its first letter. For the avatar when there is no picture.
export function initials(name, email) {
  const words = text(name).split(' ').filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  return (text(email)[0] || '?').toUpperCase();
}

// The picture the sign-in provider supplies (Google: `avatar_url` / `picture`). https only.
export function avatarOf(user) {
  const meta = user?.user_metadata || {};
  const url = [meta.avatar_url, meta.picture, ...(user?.identities || []).map(identity => identity?.identity_data?.avatar_url || identity?.identity_data?.picture)].find(value => typeof value === 'string' && /^https:\/\//.test(value));
  return { url: url || '', name: text(meta.full_name || meta.name, 80), email: text(user?.email, 120) };
}
