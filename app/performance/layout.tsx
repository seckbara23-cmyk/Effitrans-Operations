/**
 * Gestion de la Performance — the module shell.
 *
 * GATE. `performance:read`, re-checked here on every route in the segment, so
 * the answer does not depend on which URL was typed. The sidebar entry is
 * cosmetic and this layout is the boundary; a user without the capability gets
 * notFound() whether they clicked a link or pasted a path.
 *
 * The layout deliberately does NOT compute or read anything about performance.
 * It renders the tabs and the gate; every figure belongs to a page.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { PERFORMANCE_TABS } from "@/lib/performance/tabs";

export const metadata: Metadata = { title: "Gestion de la Performance" };
export const dynamic = "force-dynamic";

export default async function PerformanceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "performance:read")) notFound();

  return (
    <div className="animate-fade-in space-y-6">
      <nav aria-label="Gestion de la Performance" className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
        {PERFORMANCE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-navy-900"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
