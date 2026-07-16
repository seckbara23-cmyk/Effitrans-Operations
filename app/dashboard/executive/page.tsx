/**
 * Executive Intelligence Dashboard (Phase 7.7) — SERVER-RENDERED.
 * ---------------------------------------------------------------------------
 * The CEO / executive command center. It is an UPGRADE of the Phase-1.13B executive view, not a
 * second screen: same route, same frozen sidebar entry ("Tableau exécutif"), now composing the
 * 7.1–7.6 modules (Shipping · Air · Customs Intelligence · Document Intelligence · Portal · AI)
 * alongside the original control-tower/BI base.
 *
 * It owns NO data: every figure comes from getExecutiveIntelligence(), which composes the existing
 * bounded module readers (see lib/executive/reader.ts). It is READ-ONLY — no form, no action, no
 * mutation, no provider control. Every card drills down into the workspace that owns the number.
 *
 * Gated on executive:dashboard:read (narrower than analytics:read, which remains the Direction /
 * Rapports audience). Sections the viewer cannot read are reported as NOT INCLUDED — never as zero.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getExecutiveIntelligence } from "@/lib/executive/reader";
import { DRILL } from "@/lib/executive/links";
import { toShipmentProjection } from "@/lib/executive/compose";
import { ALERT_LEVEL_LABEL, SECTION_LABEL, type ExecutiveAlertLevel } from "@/lib/executive/types";
import { ShipmentMapLoader } from "@/components/shipping/shipment-map-loader";
import { ExecutiveCopilotPanel } from "@/components/executive/executive-copilot-panel";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Tableau exécutif" };
export const dynamic = "force-dynamic";

const DASH = "—";
const fmt = (n: number, c: string) => `${Math.round(n).toLocaleString("fr-FR")} ${c}`;

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

function Cell({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <div className="rounded-lg border border-slate-100 bg-sand-50/40 p-3 transition hover:border-teal-300">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 tabular text-lg font-bold text-navy-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** A section the viewer cannot read: stated plainly. Missing ≠ "nothing to report". */
function Unavailable({ what }: { what: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">{what} — section non incluse dans cet instantané (donnée manquante ≠ absence de problème).</p>;
}

const LEVEL_TONE: Record<ExecutiveAlertLevel, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-slate-50 text-slate-600 border-slate-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default async function ExecutiveDashboardPage() {
  const header = (
    <PageHeader
      meta="Direction"
      title={t.bi.executive.title}
      subtitle="Centre de commandement exécutif — opérations, finance, clients, documents et IA, composés depuis les modules existants."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "executive:dashboard:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.bi.forbidden}</Notice></div>;
  }

  const x = await getExecutiveIntelligence();
  const c = x.currency;
  const E = t.bi.executive;
  const deptLabel = (d: string) => (t.lifecycle.departments as Record<string, string>)[d] ?? d;

  // Access is audited (who looked, what degraded) — the metrics themselves are never stored.
  await writeAudit({
    action: AuditActions.EXECUTIVE_DASHBOARD_VIEWED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "executive",
    after: { sectionsAvailable: x.sections, sectionsUnavailable: x.unavailable, alertCounts: x.alertCounts },
  }).catch(() => {});

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* ---------------------------------------------------------------- row 1: global KPIs */}
      <section>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-7">
          {x.kpis.map((k) => (
            <Link key={k.key} href={k.href} title={`Source : ${k.source}`}>
              <StatCard label={k.label} value={k.display ?? DASH} tone={k.display == null ? "slate" : "navy"} />
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Instantané du {x.generatedAt.slice(0, 16).replace("T", " ")} · chaque indicateur provient d'un lecteur autoritatif et ouvre son espace de travail.
          {x.unavailable.length > 0 && ` · Sections non incluses : ${x.unavailable.map((s) => SECTION_LABEL[s]).join(", ")}.`}
        </p>
      </section>

      {/* ---------------------------------------------------------------- row 2: operations */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">{E.operations} — maritime · aérien · route · douane</h2>
        {x.operations ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {x.operations.modules.map((m) => (
              <div key={m.mode} className="surface p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Link href={m.href} className="text-sm font-semibold text-navy-900 hover:text-teal-700">{SECTION_LABEL[(m.mode === "ocean" ? "shipping" : m.mode) as keyof typeof SECTION_LABEL] ?? m.mode}</Link>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{m.state}</span>
                </div>
                {m.available ? (
                  <ul className="space-y-1 text-xs">
                    {m.kpis.map((k) => (
                      <li key={k.label} className="flex items-center justify-between">
                        <span className="text-slate-500">{k.label}</span>
                        <span className="tabular font-semibold text-navy-900">{k.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">Non disponible (non autorisé ou lecture en échec).</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Unavailable what="Opérations" />
        )}
      </section>

      {/* ---------------------------------------------------------------- row 3: financial */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">{E.revenue}</h2>
        {x.financial ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
              <Cell label={E.revenueMonth} value={x.financial.revenueThisMonth != null ? fmt(x.financial.revenueThisMonth, c) : DASH} href={DRILL.financial} />
              <Cell label={E.revenueYtd} value={x.financial.revenueYtd != null ? fmt(x.financial.revenueYtd, c) : DASH} href={DRILL.financial} />
              <Cell label={E.outstanding} value={x.financial.outstanding != null ? fmt(x.financial.outstanding, c) : DASH} href={DRILL.financial} />
              <Cell label={E.collected} value={x.financial.collectedThisMonth != null ? fmt(x.financial.collectedThisMonth, c) : DASH} href={DRILL.financial} />
              <Cell label={E.avgInvoice} value={x.financial.avgInvoiceValue != null ? fmt(x.financial.avgInvoiceValue, c) : DASH} href={DRILL.financial} />
              <Cell label="Délai moyen de paiement" value={x.financial.avgPaymentDelayDays != null ? `${x.financial.avgPaymentDelayDays} j` : DASH} href={DRILL.financial} />
            </div>
            <div className="surface p-5">
              <h3 className="mb-3 text-sm font-semibold text-navy-900">{E.exposure}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {x.financial.aging.map((a) => <Cell key={a.bucket} label={a.bucket} value={fmt(a.value, c)} href={DRILL.financial} />)}
              </div>
            </div>
          </>
        ) : (
          <Unavailable what="Finance (finance:read requis)" />
        )}
      </section>

      {/* ---------------------------------------------------------------- row 4: customers */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">Intelligence client</h2>
        {x.customers ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
            <Cell label={E.activeClients} value={x.customers.activeClients ?? DASH} href={DRILL.customers} />
            <Cell label="Utilisateurs portail" value={x.customers.portalUsers ?? DASH} href={DRILL.customers} />
            <Cell label="Documents partagés" value={x.customers.sharedDocuments ?? DASH} href={DRILL.documents} />
            <Cell label="Téléchargements portail" value={x.customers.portalDownloads ?? DASH} href={DRILL.customers} />
            <Cell label={`Notifications (${x.customers.notificationWindowDays} j)`} value={x.customers.notificationsDelivered ?? DASH} href={DRILL.customers} />
            <Cell label="Notifications non lues" value={x.customers.notificationsUnread ?? DASH} href={DRILL.customers} />
          </div>
        ) : (
          <Unavailable what="Clients" />
        )}
      </section>

      {/* ---------------------------------------------------------------- row 5: documents */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">Intelligence documentaire</h2>
        {x.documents ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
            <Cell label="File de revue OCR" value={x.documents.reviewQueue ?? DASH} href={DRILL.documents} />
            <Cell label="Extractions en échec" value={x.documents.failed ?? DASH} href={DRILL.documents} />
            <Cell label="Conflits non résolus" value={x.documents.unresolvedConflicts ?? DASH} href={DRILL.documents} />
            <Cell label="En file" value={x.documents.queued ?? DASH} href={DRILL.documents} />
            <Cell label="En traitement" value={x.documents.processing ?? DASH} href={DRILL.documents} />
            <Cell label="Documents obligatoires manquants" value={x.documents.missingRequired ?? DASH} href={DRILL.documents} />
          </div>
        ) : (
          <Unavailable what="Documents (document:read requis)" />
        )}
      </section>

      {/* ---------------------------------------------------------------- row 6: AI */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">Intelligence artificielle</h2>
        {x.ai ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
            <Cell label={`Requêtes (${x.ai.windowDays} j)`} value={x.ai.total} href={DRILL.ai} />
            <Cell label="Taux de succès" value={x.ai.successRatePercent != null ? `${x.ai.successRatePercent} %` : DASH} href={DRILL.ai} />
            <Cell label="Replis déterministes" value={x.ai.fallback} href={DRILL.ai} />
            <Cell label="Latence moyenne" value={x.ai.avgDurationMs != null ? `${x.ai.avgDurationMs} ms` : DASH} href={DRILL.ai} />
            <Cell label="Jetons consommés" value={x.ai.tokens ? x.ai.tokens.total.toLocaleString("fr-FR") : DASH} href={DRILL.ai} />
            <Cell label="Fournisseur" value={x.ai.providerConfigured ? x.ai.provider : "non configuré"} href={DRILL.ai} />
          </div>
        ) : (
          <Unavailable what="Intelligence artificielle (audit:read:all requis)" />
        )}
      </section>

      {/* ---------------------------------------------------------------- aggregate map */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy-900">Carte agrégée — navires · avions · livraisons · ports · aéroports</h2>
        {x.map && x.map.markers.length > 0 ? (
          <>
            <ShipmentMapLoader projection={toShipmentProjection(x.map)} />
            <p className="text-[11px] text-slate-400">
              {x.map.markers.length} marqueur(s) · statut, fraîcheur, confiance et source repris du modèle de suivi existant.
              {x.map.capped && ` Limitée aux ${x.map.cap} mouvements les plus récents par mode (jamais un balayage complet).`}
            </p>
          </>
        ) : (
          <Unavailable what="Carte agrégée (aucune position géolocalisée disponible ou transport:read requis)" />
        )}
      </section>

      {/* ---------------------------------------------------------------- alerts + timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">File d'alertes consolidée</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(x.alertCounts) as ExecutiveAlertLevel[]).map((l) => (
              <span key={l} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${LEVEL_TONE[l]}`}>
                {ALERT_LEVEL_LABEL[l]} : {x.alertCounts[l]}
              </span>
            ))}
          </div>
          {x.alerts.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune alerte dans les modules consultés.</p>
          ) : (
            <ul className="space-y-1.5">
              {x.alerts.slice(0, 12).map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs">
                  <Link href={a.href} className="text-teal-700 hover:underline">
                    <span className="font-medium">{a.reference ?? a.origin}</span>
                    {a.clientName && <span className="text-slate-400"> · {a.clientName}</span>}
                    <span className="block text-slate-600">{a.reason}</span>
                  </Link>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${LEVEL_TONE[a.level]}`}>{ALERT_LEVEL_LABEL[a.level]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Chronologie unifiée</h2>
          {x.timeline.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun événement récent dans les modules consultés.</p>
          ) : (
            <ul className="space-y-1.5">
              {x.timeline.slice(0, 12).map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs">
                  <Link href={e.href} className="text-slate-600 hover:text-teal-700">
                    <span className="tabular text-slate-400">{e.at.slice(0, 16).replace("T", " ")}</span>{" "}
                    <span className="rounded bg-slate-100 px-1 text-[9px] uppercase text-slate-500">{e.origin}</span>{" "}
                    <span className="font-medium text-navy-800">{e.reference ?? "—"}</span> · {e.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------------- governance (1.13B, retained) */}
      {x.governance && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.sla}</h2>
            <div className="space-y-1.5 text-sm">
              {x.governance.sla.map((s) => (
                <div key={s.department} className="flex items-center justify-between">
                  <span className="text-slate-600">{deptLabel(s.department)}</span>
                  <span className="text-xs">
                    <span className="text-emerald-700">{s.normal}</span> · <span className="text-amber-700">{s.warning}</span> · <span className="text-red-700">{s.critical}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.bottlenecks}</h2>
            {x.governance.bottlenecks.length === 0 ? (
              <p className="text-sm text-slate-500">{t.controlTower.bottlenecks.empty}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {x.governance.bottlenecks.map((b) => (
                  <li key={b.key} className="flex items-center justify-between">
                    <span className="text-slate-600">{b.label}</span>
                    <span className="tabular font-bold text-red-700">{b.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ---------------------------------------------------------------- top clients (1.13B, retained) */}
      {x.governance && x.governance.clients.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.topClients}</h2>
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{E.client}</th>
                    <th className="px-4 py-3 font-semibold">{E.clientRevenue}</th>
                    <th className="px-4 py-3 font-semibold">Exp.</th>
                    <th className="px-4 py-3 font-semibold">{E.clientOutstanding}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {x.governance.clients.map((cl) => (
                    <tr key={cl.clientId}>
                      <td className="px-4 py-3 text-navy-900">{cl.clientName ?? DASH}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{x.canFinance ? fmt(cl.revenue, c) : DASH}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{cl.shipments}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{x.canFinance ? fmt(cl.outstanding, c) : DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- executive AI */}
      <ExecutiveCopilotPanel />

      <p className="text-xs text-slate-400">
        <Link href={DRILL.reports} className="text-teal-700 hover:underline">Centre de rapports →</Link>
      </p>
    </div>
  );
}
