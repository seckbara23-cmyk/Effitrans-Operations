"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { DesktopSidebar, MobileSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { SessionProvider } from "@/lib/auth/use-session";
import type { ProcessNavSection } from "@/lib/process/queues/nav";

export function AppShell({
  children,
  processNav = [],
}: {
  children: React.ReactNode;
  /** Phase 5.0C — computed on the server (flag + roles). [] when the flag is off. */
  processNav?: ProcessNavSection[];
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

  return (
    <SessionProvider>
      <div className="min-h-screen bg-sand-100">
        <DesktopSidebar processNav={processNav} />
        <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} processNav={processNav} />

        <div className="lg:pl-72">
          <Topbar onOpenMenu={() => setMenuOpen(true)} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
