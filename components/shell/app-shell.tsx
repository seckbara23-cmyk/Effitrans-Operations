"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { DesktopSidebar, MobileSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { SessionProvider } from "@/lib/auth/use-session";
import type { Navigation } from "@/lib/navigation/types";

const EMPTY_NAV: Navigation = {
  sections: [],
  primaryRoleLabel: null,
  myWorkHref: null,
  filtered: true,
};

export function AppShell({
  children,
  navigation = EMPTY_NAV,
}: {
  children: React.ReactNode;
  /**
   * Phase 5.0E-1 — the WHOLE sidebar, already filtered for this user by the single
   * server-side builder. The shell makes no visibility decision of its own.
   */
  navigation?: Navigation;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Auth pages render without the app chrome.
  if (pathname === "/login") {
    return <SessionProvider>{children}</SessionProvider>;
  }

  // The customer portal is a separate surface — no internal chrome / session.
  // It provides its own shell + guard (lib/portal). Never leak internal nav.
  if (pathname.startsWith("/portal")) {
    return <>{children}</>;
  }

  // The driver mobile workspace has its own mobile shell (Phase 3.4C) — never the
  // staff sidebar. Drivers must not see internal staff navigation.
  if (pathname.startsWith("/driver")) {
    return <>{children}</>;
  }

  // The platform administration surface (Phase 4.0B) has its OWN shell + guard —
  // never the tenant sidebar. Tenant users must not see platform navigation.
  if (pathname.startsWith("/platform")) {
    return <>{children}</>;
  }

  // Public digital business cards (DBC-3) are a public surface with their own full-page
  // layout — never the tenant chrome, never a session.
  if (pathname.startsWith("/card")) {
    return <>{children}</>;
  }

  // The coursier's deposit-run surface (Phase 5.0E-3). A courier-only user holds no
  // analytics:read and no file:read, so every staff section resolved empty for them —
  // we were rendering a sidebar of nothing. They get a dedicated surface, like a
  // driver. (A COURIER who also holds an operational role is still staff, and their
  // sidebar renders normally on every other route.)
  if (pathname.startsWith("/courier")) {
    return <SessionProvider>{children}</SessionProvider>;
  }

  return (
    <SessionProvider>
      <div className="min-h-screen bg-sand-100">
        <DesktopSidebar
          sections={navigation.sections}
          filtered={navigation.filtered}
          roleLabel={navigation.primaryRoleLabel}
        />
        <MobileSidebar
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          sections={navigation.sections}
          filtered={navigation.filtered}
          roleLabel={navigation.primaryRoleLabel}
        />

        <div className="lg:pl-72">
          <Topbar onOpenMenu={() => setMenuOpen(true)} roleLabel={navigation.primaryRoleLabel} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
