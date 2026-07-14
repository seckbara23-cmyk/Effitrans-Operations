/**
 * Pilot console (Phase 5.0E-2B, Deliverables 2/4/8/12). ADMIN-ONLY DIAGNOSTIC.
 * ---------------------------------------------------------------------------
 * One page for whoever is running the pilot: the role matrix, the guided 26-step
 * checklist, the safe metrics, and the dossier inventory that unblocks the
 * historical-compatibility decision.
 *
 * Gated on `admin:config:manage` (SYSTEM_ADMIN). Not a staff feature and not part of
 * the workflow — it 404s for everyone else, and it is invisible in navigation.
 *
 * Contains NO credentials. The setup checklist tells an administrator what to CREATE;
 * it never carries a password, and this page never creates a user.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getTenantProcessFlags } from "@/lib/process/rollout-server";
import { buildPilotMatrix } from "@/lib/pilot/matrix";
import { buildPilotChecklist, checklistCoverage } from "@/lib/pilot/checklist";
import { getPilotMetrics } from "@/lib/pilot/observability";
import { getDossierInventory } from "@/lib/pilot/inventory";
import { getRolloutProof } from "@/lib/pilot/rollout-proof";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Console pilote" };

const TABS = [
  { key: "checklist", label: "Parcours guidé" },
  { key: "roles", label: "Matrice des rôles" },
  { key: "metrics", label: "Observabilité" },
  { key: "inventory", label: "Inventaire dossiers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{title}</h2>
      {children}
    </section>
  );
}

function ProofLine({ label, value, strong }: { label: string; value: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-slate-600", strong && "font-bold text-navy-900")}>{label}</dt>
      <dd
        className={cn(
          "font-semibold",
          value ? "text-emerald-700" : "text-red-700",
          strong && "text-sm",
        )}
      >
        {value ? "true" : "false"}
      </dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={cn(
          "tabular text-lg font-bold",
          tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-navy-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default async function PilotConsole({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) notFound();

  const flags = await getTenantProcessFlags(user.tenantId);
  const proof = await getRolloutProof(user.tenantId);

  const tab: TabKey = (TABS.find((t) => t.key === searchParams?.tab)?.key ?? "checklist") as TabKey;

  const checklist = buildPilotChecklist();
  const coverage = checklistCoverage(checklist);
  const matrix = buildPilotMatrix();

  // Only queried for the tab being viewed — a diagnostic page should not cost four
  // round trips to show one table.
  const metrics = tab === "metrics" ? await getPilotMetrics(user.tenantId) : null;
  const inventory = tab === "inventory" ? await getDossierInventory(user.tenantId) : null;

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Console pilote</h1>
        <p className="text-sm text-slate-600">
          Processus officiel Effitrans ·{" "}
          {flags.enabled ? (
            <span className="font-semibold text-emerald-700">ACTIF pour ce tenant</span>
          ) : (
            <span className="font-semibold text-amber-700">
              INACTIF pour ce tenant — activation via la console plateforme
            </span>
          )}
        </p>
      </header>

      {/* ---------------------------------------------------- ROLLOUT PROOF ----
          The eight numbers, printed by the app itself. These are not a report ABOUT
          the resolvers — they ARE the resolvers, called on this request, the same ones
          the sidebar and every route guard used. If Effective Workspaces is false here,
          Mon Travail 404s, and that is the same function saying so twice. */}
      <section
        className={cn(
          "rounded-lg border p-4",
          proof.effectiveWorkspaces
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50",
        )}
      >
        <h2 className="mb-2 text-sm font-semibold text-navy-900">État effectif du déploiement</h2>

        <dl className="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-2">
          <ProofLine label="Global Engine" value={proof.globalEngine} />
          <ProofLine label="Global Workspaces" value={proof.globalWorkspaces} />
          <ProofLine label="Tenant Engine" value={proof.tenantEngine} />
          <ProofLine label="Tenant Workspaces" value={proof.tenantWorkspaces} />
          <ProofLine label="Effective Engine" value={proof.effectiveEngine} strong />
          <ProofLine label="Effective Workspaces" value={proof.effectiveWorkspaces} strong />
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="text-slate-600">Organization ID</dt>
            <dd className="truncate text-navy-900">{proof.organizationId}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="text-slate-600">Organization Slug</dt>
            <dd className="truncate text-navy-900">{proof.organizationSlug ?? "— (non défini)"}</dd>
          </div>
        </dl>

        <p className="mt-3 border-t border-black/5 pt-2 text-xs text-slate-700">
          <span className="font-semibold">Verdict : </span>
          {proof.verdict}
        </p>
        {proof.rolloutTableMissing && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-900">
            <span className="font-bold">La table n&apos;existe pas.</span> La migration
            <code> 20260714000004_tenant_process_rollout</code> n&apos;a jamais été appliquée à
            cette base. Aucune activation n&apos;est possible tant que ce n&apos;est pas fait.
            {proof.dbError && <span className="block font-mono">{proof.dbError}</span>}
          </p>
        )}

        {proof.rolloutRowMissing && (
          <p className="mt-1 text-[11px] text-slate-500">
            Aucune ligne dans <code>tenant_process_rollout</code> — ce qui signifie DÉSACTIVÉ. Une
            ligne absente et une ligne à false sont identiques pour le résolveur (c&apos;est
            voulu), mais pas pour vous : ici, personne n&apos;a encore activé ce tenant.
          </p>
        )}

        {proof.platformAdminCount === 0 && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-900">
            <span className="font-bold">Aucun administrateur plateforme n&apos;existe.</span> Seul
            un <code>PLATFORM_SUPER_ADMIN</code> peut activer un tenant, et un{" "}
            <code>SYSTEM_ADMIN</code> de tenant ne peut pas activer le sien (c&apos;est voulu :
            aucune police RLS, aucun privilège d&apos;écriture). Personne ne peut donc ouvrir{" "}
            <code>/platform/rollout</code>. Exécuter une fois{" "}
            <code>supabase/scripts/bootstrap_platform_admin.sql</code>.
          </p>
        )}
      </section>

      <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings/pilot?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              t.key === tab ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* ------------------------------------------------------------ CHECKLIST */}
      {tab === "checklist" && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Étapes officielles" value={coverage.total} />
            <Stat label="Exécutables" value={coverage.executable} tone="ok" />
            <Stat
              label="Non exécutables"
              value={coverage.blocked}
              tone={coverage.blocked > 0 ? "warn" : undefined}
            />
            <Stat label="Maker-checker" value={coverage.makerCheckerSteps.length} />
          </div>

          {coverage.blocked > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">
                {coverage.blocked} étape(s) ne peuvent PAS être testées par un utilisateur réel.
              </p>
              <p className="mt-1 text-xs">
                Le rôle officiel correspondant n&apos;est associé à aucun rôle tenant (constat de la
                phase 5.0A). Un pilote qui ignorerait ce fait déclarerait « 26/26 » en n&apos;en ayant
                réellement exécuté que {coverage.executable}.
              </p>
            </div>
          )}

          <Card title="Parcours guidé — 26 étapes">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Étape</th>
                    <th className="py-2 pr-3">Rôle</th>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Résultat attendu</th>
                    <th className="py-2 pr-3">Rôle suivant</th>
                  </tr>
                </thead>
                <tbody>
                  {checklist.map((c) => (
                    <tr
                      key={c.stepKey}
                      className={cn("border-b border-slate-50", c.blocked && "bg-amber-50/60")}
                    >
                      <td className="py-2 pr-3 tabular font-semibold text-navy-900">{c.stepNumber}</td>
                      <td className="py-2 pr-3">
                        <span className="font-medium text-navy-900">{c.label}</span>
                        {c.makerChecker && (
                          <span className="ml-1.5 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-bold text-violet-700">
                            maker-checker
                          </span>
                        )}
                        {c.parallel && (
                          <span className="ml-1.5 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-bold text-blue-700">
                            parallèle
                          </span>
                        )}
                        {c.blocked && <p className="mt-0.5 text-[11px] text-amber-800">{c.blocked}</p>}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">{c.actorLabel}</td>
                      <td className="py-2 pr-3">
                        <code className="text-[11px] text-teal-700">{c.route}</code>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{c.expectedResult}</td>
                      <td className="py-2 pr-3 text-slate-500">{c.nextActorLabel ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- ROLES */}
      {tab === "roles" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Dérivée du constructeur de navigation et du registre des files — ce tableau ne peut pas
            diverger de l&apos;application, il l&apos;observe.
          </p>
          {matrix.map((m) => (
            <Card key={m.role.roleCode} title={`${m.role.officialTitle} — ${m.displayLabel}`}>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">Page d&apos;arrivée</p>
                  <code className="text-xs font-semibold text-teal-700">{m.landing}</code>

                  <p className="mt-2 text-xs text-slate-500">Files autorisées</p>
                  <p className="text-xs text-navy-900">
                    {m.queues.length ? m.queues.map((q) => q.label).join(", ") : "aucune"}
                  </p>

                  <p className="mt-2 text-xs text-slate-500">
                    Files masquées ({m.hiddenQueues.length}/15)
                  </p>
                  <p className="text-[11px] text-slate-400">{m.hiddenQueues.join(", ") || "—"}</p>

                  {m.ownedSteps.length > 0 && (
                    <>
                      <p className="mt-2 text-xs text-slate-500">Étapes officielles</p>
                      <p className="text-[11px] text-slate-600">
                        {m.ownedSteps.map((s) => s.number).join(", ")}
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <p className="text-xs text-slate-500">Actions à tester</p>
                  <ul className="ml-4 list-disc text-xs text-navy-900">
                    {m.role.primaryActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>

                  <p className="mt-2 text-xs font-semibold text-red-700">Doit être IMPOSSIBLE</p>
                  <ul className="ml-4 list-disc text-xs text-red-800">
                    {m.role.forbidden.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------------- METRICS */}
      {tab === "metrics" && metrics && (
        <>
          <p className="text-xs text-slate-500">
            Compteurs uniquement. Aucun contenu de document, note de recouvrement, communication ou
            donnée client n&apos;est lu par cette page — les requêtes ne sélectionnent que des
            statuts et des identifiants.
          </p>

          <Card title="Processus">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Instances" value={metrics.processInstances.total} />
              <Stat label="Actives" value={metrics.processInstances.active} />
              <Stat label="Clôturées" value={metrics.processInstances.closed} />
            </div>
          </Card>

          <Card title="Étapes">
            <div className="grid gap-2 sm:grid-cols-5">
              <Stat label="Actives" value={metrics.steps.active} />
              <Stat label="Soumises" value={metrics.steps.submitted} />
              <Stat label="Bloquées" value={metrics.steps.blocked} tone={metrics.steps.blocked ? "warn" : undefined} />
              <Stat label="Rejetées" value={metrics.steps.rejected} />
              <Stat label="Terminées" value={metrics.steps.completed} tone="ok" />
            </div>
          </Card>

          <Card title="Transferts">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Envoyés" value={metrics.handoffs.sent} />
              <Stat label="Réceptionnés" value={metrics.handoffs.received} tone="ok" />
              <Stat label="Refusés" value={metrics.handoffs.rejected} />
            </div>
          </Card>

          <Card title="Sécurité et clôture">
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat
                label="Accès refusés"
                value={metrics.unauthorizedAttempts}
                tone={metrics.unauthorizedAttempts ? "warn" : undefined}
              />
              <Stat label="Clôtures tentées" value={metrics.closeAttempts.total} />
              <Stat label="Clôtures réussies" value={metrics.closeAttempts.succeeded} />
              <Stat label="Clôtures refusées" value={metrics.closeAttempts.refused} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Chargement des compteurs : {metrics.queueLoadMs} ms
            </p>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------ INVENTORY */}
      {tab === "inventory" && inventory && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <p className="font-semibold text-navy-900">
              Décision bloquée depuis la phase 5.0A : la reprise de l&apos;historique.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Voici le comptage qui la débloque. Agrégats uniquement — aucun numéro de dossier,
              aucun client. AUCUNE reprise n&apos;est exécutée ici : cette page est en lecture seule
              et n&apos;a pas de contrepartie « appliquer ».
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Dossiers" value={inventory.total} />
            <Stat label="Avec instance" value={inventory.totalWithInstance} tone="ok" />
            <Stat
              label="Sans instance"
              value={inventory.totalWithoutInstance}
              tone={inventory.totalWithoutInstance ? "warn" : undefined}
            />
            <Stat label="Terminés, sans instance" value={inventory.terminalWithoutInstance} />
          </div>

          <Card title="Distribution par statut">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2 pr-3 text-right">Nombre</th>
                  <th className="py-2 pr-3 text-right">Avec instance</th>
                  <th className="py-2 pr-3 text-right">Sans instance</th>
                  <th className="py-2 pr-3 text-right">Plus ancien (j)</th>
                  <th className="py-2 pr-3 text-right">Plus récent (j)</th>
                </tr>
              </thead>
              <tbody>
                {inventory.buckets.map((b) => (
                  <tr key={b.status} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-medium text-navy-900">{b.status}</td>
                    <td className="py-2 pr-3 text-right tabular">{b.count}</td>
                    <td className="py-2 pr-3 text-right tabular text-emerald-700">{b.withInstance}</td>
                    <td className="py-2 pr-3 text-right tabular text-amber-700">{b.withoutInstance}</td>
                    <td className="py-2 pr-3 text-right tabular text-slate-500">{b.oldestDays ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular text-slate-500">{b.newestDays ?? "—"}</td>
                  </tr>
                ))}
                {inventory.buckets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      Aucun dossier.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </main>
  );
}
