import { requireAdminUser } from '../../../../src/lib/agentServiceProxy';
import { createVisitorGovernanceHandler } from '../../../../src/lib/visitorGovernanceProxy.mjs';

export default createVisitorGovernanceHandler({ requireAdmin: requireAdminUser });
export const config = { api: { bodyParser: { sizeLimit: '2kb' }, responseLimit: '4mb' } };
