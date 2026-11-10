import stylesheet from 'swagger-ui-dist/swagger-ui.css?private-docs-text';
import { requireAdminUser } from '../../../src/lib/agentServiceProxy';
import { createAdminDocsHandler } from '../../../src/lib/adminDocsHandler.mjs';

export default createAdminDocsHandler({
  requireAdmin: requireAdminUser,
  getStylesheet: async () => stylesheet,
});
