import { sendContactMail } from '../../src/lib/contactMail.mjs';
import { discoveryEnabled, discoveryRuntime } from '../../src/lib/discovery/runtime.mjs';
import { isRateLimited } from '../../src/lib/rateLimiter';
import { createContactHandler } from '../../src/lib/contactGuard.mjs';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default createContactHandler({ isRateLimited, sendMail: sendContactMail,
  moderate: (channel, text, context) => discoveryEnabled() ? discoveryRuntime().moderate(channel, text, context) : { decision: 'allow' },
});
