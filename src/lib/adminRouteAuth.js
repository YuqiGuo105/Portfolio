import { requireAdminUser } from "./agentServiceProxy";

// All admin APIs use the same server-managed role source.
export const requireAdmin = requireAdminUser;
