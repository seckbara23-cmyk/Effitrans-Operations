"use client";

/**
 * Platform administration shell (Phase 4.0B-4). CLIENT.
 * ---------------------------------------------------------------------------
 * A distinct shell for the platform surface — platform-branded, with the platform
 * nav only. It receives the resolved platform user from the server layout (which
 * enforces the authorization boundary), so it needs no tenant session context and
 * can never render tenant navigation.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { visiblePlatformNav } from "@/lib/platform/nav";
import { PLATFORM_BRANDING } from "@/lib/branding/platform";

export function PlatformShell({
  email,
  role,
  permissions,
  children,
}: {
  email: string;
  role: string;
  permissions: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items = visiblePlatformNav(permissions);

  async function signOut() {
    await getBrowserSupabaseClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-white/10 bg-navy-950 lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">EP</span>
          <div className="leading-tight">
            <p className="text-[15px] font-bold text-white">{PLATFORM_BRANDING.displayName}</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300">Administration</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/platform" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-lg px-3 py-2.5 text-[15px] font-semibold transition-colors",
                  active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-[13px] font-semibold text-white">{email}</p>
          <p className="mb-3 truncate text-[12px] font-medium text-teal-300">{role}</p>
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-navy-950/80 backdrop-blur">
          <div className="flex h-16 items-center px-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300">{PLATFORM_BRANDING.displayName}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-5 py-8 text-slate-100">{children}</main>
      </div>
    </div>
  );
}
