import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listProviders } from "@/lib/subcontractors/service";
import { ProviderConsole } from "@/components/subcontractors/provider-console";

export const metadata: Metadata = { title: "Sous-traitants" };
export const dynamic = "force-dynamic";

export default async function SousTraitantsPage() {
  const header = (
    <PageHeader
      meta="Transport"
      title="Sous-traitants"
      subtitle="Transporteurs externes agréés pour l'exécution du transport terrestre."
    />
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div></div>;
  }
  const canManage = hasPermission(permissions, "transport:manage");

  const providers = await listProviders();
  const approved = providers.filter((p) => p.isActive && p.status === "APPROVED").length;
  const suspended = providers.filter((p) => p.isActive && p.status === "SUSPENDED").length;

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <Link href="/departments/transport" className="text-sm text-teal-700 hover:underline">← Transport</Link>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="surface p-4">
          <p className="text-xs text-slate-500">Sous-traitants</p>
          <p className="mt-1 text-2xl font-semibold text-navy-900">{providers.filter((p) => p.isActive).length}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-slate-500">Agréés</p>
          <p className="mt-1 text-2xl font-semibold text-teal-700">{approved}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-slate-500">Suspendus</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{suspended}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-slate-500">Transports confiés</p>
          <p className="mt-1 text-2xl font-semibold text-navy-800">
            {providers.reduce((n, p) => n + p.transportCount, 0)}
          </p>
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun sous-traitant enregistré.{" "}
          {canManage
            ? "Ajoutez le premier transporteur externe ci-dessous."
            : "Un responsable Transport peut enregistrer les transporteurs externes."}
          {" "}Un transporteur ponctuel peut aussi être saisi en texte libre sur le transport lui-même.
        </div>
      ) : (
        <div className="surface overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Sous-traitant</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Agrément</th>
                <th className="px-4 py-2">Transports confiés</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providers.map((p) => (
                <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-navy-900">{p.name}</span>
                    {p.ninea && <div className="text-xs text-slate-500">NINEA {p.ninea}</div>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {[p.contactName, p.phone, p.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-2">
                    {p.status === "APPROVED" ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">Agréé</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Suspendu</span>
                    )}
                    {!p.isActive && <span className="ml-1 text-xs text-slate-400">retiré</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {/* DERIVED from transport_record — never a stored counter. */}
                    {p.transportCount}
                    {p.engagedFileNumbers.length > 0 && (
                      <span className="ml-1 text-xs text-navy-800">· en cours : {p.engagedFileNumbers.join(", ")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <ProviderConsole providers={providers} />
      ) : (
        <p className="surface p-4 text-xs text-slate-500">
          Consultation seule : l&apos;enregistrement et l&apos;agrément des sous-traitants relèvent du
          Responsable Transport.
        </p>
      )}
    </div>
  );
}
