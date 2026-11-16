import { sendContactMail } from '../../src/lib/contactMail.mjs';
import { discoveryEnabled, discoveryRuntime } from '../../src/lib/discovery/runtime.mjs';
import { isRateLimited } from '../../src/lib/rateLimiter';
import { createContactHandler } from '../../src/lib/contactGuard.mjs';
import { keepPreviewMail, talkPreviewEnabled } from '../../src/lib/talkPreview.mjs';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

// The local Talk preview skips bot verification and keeps the message instead of emailing it.
const preview = talkPreviewEnabled();

export default createContactHandler({ isRateLimited: preview ? async () => false : isRateLimited,
  sendMail: preview ? async fields => keepPreviewMail({ kind: 'message', subject: `New message from ${fields.name}`, replyTo: fields.email, text: fields.message, attachments: [] }) : sendContactMail,
  ...(preview ? { verifyToken: async () => {} } : {}),
  moderate: (channel, text, context) => discoveryEnabled() ? discoveryRuntime().moderate(channel, text, context) : { decision: 'allow' },
});
