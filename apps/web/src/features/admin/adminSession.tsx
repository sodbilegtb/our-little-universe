import { createContext, useContext, type ReactNode } from 'react';
import type { AdminSession } from '@/services/api';

const AdminSessionContext = createContext<AdminSession | null>(null);

export function AdminSessionProvider({ session, children }: { session: AdminSession; children: ReactNode }) {
  return <AdminSessionContext.Provider value={session}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error('useAdminSession must be used inside AdminSessionProvider');
  return session;
}

const STORAGE_KEY = 'olu.admin.session';

/** Mock only: kept per tab. Milestone 3 replaces this with an HttpOnly cookie. */
export const adminSessionStore = {
  read(): AdminSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AdminSession) : null;
    } catch {
      return null;
    }
  },
  save(session: AdminSession) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  },
  clear() {
    sessionStorage.removeItem(STORAGE_KEY);
  },
};
