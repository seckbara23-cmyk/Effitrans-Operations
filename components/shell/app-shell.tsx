"use client";

import { useState } from "react";
import { DesktopSidebar, MobileSidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-sand-100">
      <DesktopSidebar />
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="lg:pl-72">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
