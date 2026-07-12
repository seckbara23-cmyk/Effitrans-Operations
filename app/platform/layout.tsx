import { redirect } from "next/navigation";
import { getPlatformUser } from "@/lib/platform/auth";
import { getSessionClass } from "@/lib/auth/current-user";
import { PlatformShell } from "@/components/platform/platform-shell";

// The platform surface is always dynamic (per-request platform identity).
export const dynamic = "force-dynamic";

/**
 * Platform layout — the REAL platform authorization boundary. Only an active
 * platform admin renders; a tenant user is routed to their own home (never the
 * platform), a signed-out visitor to /login. No implicit inheritance.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getPlatformUser();
  if (!user) {
    const cls = await getSessionClass();
    redirect(cls === "portal" ? "/portal" : cls === "staff" ? "/dashboard" : "/login");
  }
  return (
    <PlatformShell email={user.email} role={user.role} permissions={user.permissions}>
      {children}
    </PlatformShell>
  );
}
