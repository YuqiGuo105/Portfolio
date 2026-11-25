// Where "Chat or call live" goes: Yuqi's TalkNest deployment. `connect` tells TalkNest who the
// visitor came to talk to, so it can open that conversation after sign-in instead of an empty inbox.
export const TALKNEST_URL = process.env.NEXT_PUBLIC_TALKNEST_URL || 'https://talknest-refresh.onrender.com/?connect=Yuqi%20Guo';
export const TALK_PATH = '/talk';
// The referral form has its own address so that a shared link previews as "Ask for a referral",
// not as the general Talk page. /talk?intent=referral redirects here (next.config.js).
export const REFERRAL_PATH = '/referral';
export const referralHref = REFERRAL_PATH;
