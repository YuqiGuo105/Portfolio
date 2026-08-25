import { createContext, useContext } from "react";

const AdminSessionContext = createContext(null);

export const AdminSessionProvider = AdminSessionContext.Provider;

export function useAdminSession() {
  return useContext(AdminSessionContext);
}
