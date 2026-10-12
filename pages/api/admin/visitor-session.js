import { requireAdminUser } from '../../../src/lib/agentServiceProxy';
import { createVisitorSessionHandler } from '../../../src/lib/visitorSession.mjs';

export default createVisitorSessionHandler({ requireAdmin: requireAdminUser });
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
