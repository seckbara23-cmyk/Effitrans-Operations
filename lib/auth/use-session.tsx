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
import { mergeBranding } from "@/lib/branding/resolve";

// Pure cosmetic-visibility rule lives in its own module so it is unit-testable
// without importing this client component. Re-exported for existing callers.
export { canSeeNav } from "./nav-visibility";

export type SessionState = {
  email: string | null;
  permissions: string[];
  /** tenant-resolved brand (own tenant only) for the staff shell; null pre-resolve */
  brandName: string | null;
  tagline: string | null;
  loading: boolean;
  configured: boolean;
};

const SessionContext = createContext<SessionState>({
  email: null,
  permissions: [],
  brandName: null,
  tagline: null,
  loading: false,
  configured: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  // Deterministic initial state on the server AND the first client render — do
  // NOT branch on env here. NEXT_PUBLIC_* are inlined at build time, so a stale
  // client bundle can disagree with the server runtime and cause a hydration
  // mismatch (this exact crash). Real config/session is resolved only AFTER
  // mount, inside the effect, where server/client can safely differ.
  const [state, setState] = useState<SessionState>({
    email: null,
    permissions: [],
    brandName: null,
    tagline: null,
    loading: true,
    configured: false,
  });

  useEffect(() => {
    const configured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    if (!configured) {
      setState({ email: null, permissions: [], brandName: null, tagline: null, loading: false, configured: false });
      return;
    }

    let active = true;
    (async () => {
      // Fully guarded: a client Supabase failure degrades to logged-out, never
      // crashes the app (SessionProvider wraps the whole shell).
      try {
        const supabase = getBrowserSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (active) setState({ email: null, permissions: [], brandName: null, tagline: null, loading: false, configured: true });
          return;
        }
        const { data } = await supabase.rpc("get_user_permissions", { p_user: user.id });
        const permissions = (data ?? []).map((r) => r.code);

        // Tenant-resolved staff-shell brand (own tenant only, via RLS: staff read
        // their own organization + tenant_branding). Cosmetic — failures are
        // swallowed and the shell keeps its safe Effitrans default.
        let brandName: string | null = null;
        let tagline: string | null = null;
        try {
          const { data: au } = await supabase.from("app_user").select("tenant_id").eq("id", user.id).maybeSingle();
          const tid = au?.tenant_id;
          if (tid) {
            const [{ data: org }, { data: brand }] = await Promise.all([
              supabase.from("organization").select("name, trade_name, legal_name").eq("id", tid).maybeSingle(),
              supabase.from("tenant_branding").select("display_name, tagline").eq("tenant_id", tid).maybeSingle(),
            ]);
            if (org) {
              const merged = mergeBranding(
                { name: org.name ?? "", tradeName: org.trade_name ?? null, legalName: org.legal_name ?? null },
                brand ?? null,
              );
              brandName = merged.displayName;
              tagline = merged.tagline ?? null;
            }
          }
        } catch {
          /* cosmetic branding fetch failed → keep safe defaults */
        }

        if (active) setState({ email: user.email ?? null, permissions, brandName, tagline, loading: false, configured: true });
      } catch {
        if (active) setState({ email: null, permissions: [], brandName: null, tagline: null, loading: false, configured: false });
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
