/**
 * New company — the provisioning wizard route (Phase 6.0B). Platform only.
 * ---------------------------------------------------------------------------
 * The server boundary. It resolves and enforces the platform identity BEFORE the
 * wizard renders, so the client never carries — and can never assert — the platform
 * actor. The actual actor is resolved AGAIN, server-side, inside provisionTenant()
 * (6.0A); this gate just keeps a non-admin from ever seeing the form.
 *
 * The wizard itself is a client component. It creates nothing until the final
 * confirmation, and it calls the existing provisionTenant() action — there is no
 * second provisioning path.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { ProvisioningWizard } from "@/components/platform/provisioning-wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouvelle entreprise" };

export default async function NewCompanyPage() {
  // Only a platform admin holding platform:companies:create may provision. This is the
  // SAME permission the action re-checks; a hidden route was never the authorization.
  await assertPlatformPermission("platform:companies:create");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Nouvelle entreprise</h1>
          <p className="mt-1 text-sm text-slate-400">
            Provisionnez une nouvelle société de logistique — sans SQL, sans script.
          </p>
        </div>
        <Link
          href="/platform/companies"
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
        >
          Retour à la liste
        </Link>
      </div>

      <ProvisioningWizard />
    </div>
  );
}
