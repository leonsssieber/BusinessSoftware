import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { SessionPayload } from "@core/server/context";
import { api, ApiError, AUTH_EXPIRED_EVENT } from "./api";
import { PageLoader } from "./components/display";

export type Session = SessionPayload;

interface AuthState {
  /** `undefined` while loading, `null` when signed out. */
  session: Session | null | undefined;
  setSession: (s: Session | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get<Session>("/api/auth/me"));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setSession(null);
      else setSession((s) => s ?? null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onExpired = () => setSession(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [refresh]);

  const value = useMemo(() => ({ session, setSession, refresh, signOut }), [session, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The signed-in session. Only use inside <RequireAuth>. */
export function useSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error("useSession used outside RequireAuth");
  return session;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (session === undefined) return <PageLoader />;
  if (session === null) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Sends signed-in users away from the sign-in pages. */
export function RedirectIfSignedIn({ children, to = "/app" }: { children: ReactNode; to?: string }) {
  const { session } = useAuth();
  if (session === undefined) return <PageLoader />;
  if (session) return <Navigate to={to} replace />;
  return <>{children}</>;
}
