"use client";

/**
 * Client session context (UI-2). COSMETIC ONLY.
 * ---------------------------------------------------------------------------
 * Exposes the signed-in user's email + permission codes to client chrome
 * (topbar, sidebar) so nav can be visually filtered and the account shown.
 *
 * This is NOT a security boundary — server components, RLS, and route guards
 * remain authoritative. When Supabase is not configured, it stays inert and
 * the UI shows everything (the existing mock experience).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";

// Pure cosmetic-visibility rule lives in its own module so it is unit-testable
// without importing this client component. Re-exported for existing callers.
export { canSeeNav } from "./nav-visibility";

export type SessionState = {
  email: string | null;
  permissions: string[];
  loading: boolean;
  configured: boolean;
};

const SessionContext = createContext<SessionState>({
  email: null,
  permissions: [],
  loading: false,
  configured: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const [state, setState] = useState<SessionState>({
    email: null,
    permissions: [],
    loading: configured,
    configured,
  });

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const supabase = getBrowserSupabaseClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setState({ email: null, permissions: [], loading: false, configured });
        return;
      }
      const { data } = await supabase.rpc("get_user_permissions", { p_user: user.id });
      const permissions = ((data ?? []) as unknown as { code: string }[]).map((r) => r.code);
      if (active) setState({ email: user.email ?? null, permissions, loading: false, configured });
    })();

    return () => {
      active = false;
    };
  }, [configured]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
