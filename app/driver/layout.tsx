import type { Metadata } from "next";
import { requireDriver } from "@/lib/driver/auth";
import { DriverShell } from "@/components/driver/driver-shell";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.driver.appName };

// Auth-dependent (DRIVER guard): never prerender.
export const dynamic = "force-dynamic";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  // Guard: DRIVER only. Staff → /dashboard, portal → /portal, none → /login.
  // Never calls the staff requireUser, so no redirect loop.
  await requireDriver();
  return <DriverShell>{children}</DriverShell>;
}
