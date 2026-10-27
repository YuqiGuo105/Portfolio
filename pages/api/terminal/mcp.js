import { createTerminalMcpHandler } from '../../../src/lib/terminalMcp.mjs';
import { isRateLimited } from '../../../src/lib/rateLimiter';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default createTerminalMcpHandler({ isRateLimited });
