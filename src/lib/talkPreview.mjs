// Local preview of the Talk page (`npm run dev:talk`). It exists only in a development build
// started with TALK_PREVIEW=1 and answering on localhost: a deployed site can never be in it.
// In preview, bot verification is skipped and no email leaves the machine; what would have been
// sent is kept in memory so the preview page can show it.
export const talkPreviewEnabled = () => process.env.NODE_ENV === 'development' && process.env.TALK_PREVIEW === '1';
export const localHost = req => /^(localhost|127\.0\.0\.1):\d+$/.test(req?.headers?.host || '');

const KEY = Symbol.for('portfolio.talk.preview.outbox.v1');
export function previewOutbox() { return (globalThis[KEY] ||= []); }
export function keepPreviewMail(entry) {
  const outbox = previewOutbox();
  outbox.unshift({ at: new Date().toISOString(), ...entry });
  outbox.splice(20);
}
