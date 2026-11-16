// Where "Chat or call live" goes: Yuqi's TalkNest deployment. `connect` tells TalkNest who the
// visitor came to talk to, so it can open that conversation after sign-in instead of an empty inbox.
export const TALKNEST_URL = process.env.NEXT_PUBLIC_TALKNEST_URL || 'https://talknest-refresh.onrender.com/?connect=Yuqi%20Guo';
export const TALK_PATH = '/talk';
export const referralHref = `${TALK_PATH}?intent=referral`;
