import { createServiceMetricsHandler } from "../../../src/lib/serviceMetrics.mjs";
import { loadPublicServiceCatalog } from "../../../src/lib/server/monitoringRegistry.mjs";

export default createServiceMetricsHandler({ getCatalog: loadPublicServiceCatalog });
