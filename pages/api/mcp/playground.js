import { createPlaygroundHandler } from '../../../src/lib/mcpPlayground.mjs';
import { isRateLimited } from '../../../src/lib/rateLimiter';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default createPlaygroundHandler({ isRateLimited });
