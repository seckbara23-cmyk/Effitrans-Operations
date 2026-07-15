/**
 * Company Detail Console (Phase 6.0C). SERVER — platform only.
 * ---------------------------------------------------------------------------
 * The platform admin's control center for one tenant. Tabs are server-rendered
 * sections selected by ?tab= (no client router state, so a tab is a shareable URL and
 * costs nothing until opened). The Rollout tab embeds the EXISTING RolloutControls;
 * the Audit tab paginates the EXISTING audit_log through a per-tenant read. Every read
 * is one of the bounded, platform-gated readers — no engine change, no new mutation.
 *
 * Only ACTIONS THAT EXIST are surfaced (rollout toggles, copy slug/id). Suspend /
 * resume / archive are deliberately absent: no lifecycle action or enforcement exists
 * yet (a later sub-phase), and a button that changes a flag which blocks nothing would
 * mislead.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { getCompany, type CompanySummary } from "@/lib/platform/companies";
import { listCompanyUsers, listCompanyAuditEvents } from "@/lib/platform/company-detail";
import { getRolloutOverview } from "@/lib/platform/rollout-read";
import { resolveTenantBranding } from "@/lib/branding/service";
import { deriveTrialState, deriveCompanyHealth, type TrialState } from "@/lib/platform/console/table";
import { lifecycleBadge, onboardingBadge, HEALTH_BADGES, TONE_CLASS } from "@/lib/platform/console/badges";
import { resolveTenantModules, isPlanKey } from "@/lib/platform/entitlements";
import { RolloutControls } from "@/components/platform/rollout-controls";
import { CopyButton } from "@/components/platform/copy-button";
import { LifecycleActions } from "@/components/platform/lifecycle-actions";
import { isLifecycleStatus } from "@/lib/platform/company-metadata";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entreprise" };

const TABS = [
  { key: "overview", label: "Aperçu" },
  { key: "branding", label: "Marque" },
  { key: "subscription", label: "Abonnement" },
  { key: "users", label: "Utilisateurs" },
  { key: "rollout", label: "Déploiement" },
  { key: "audit", label: "Audit" },
  { key: "health", label: "Santé" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Badge({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[tone])}>{label}</span>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[12px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-[15px] font-semibold text-white">{value}</p>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function trialText(trial: TrialState): string {
  if (!trial.onTrial) return "—";
  if (trial.expired) return "Essai expiré";
  return `${trial.daysLeft} jour(s) restant(s)`;
}

export default async function PlatformCompanyDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string; page?: string };
}) {
  await assertPlatformPermission("platform:companies:read");

  const c = await getCompany(params.id);
  if (!c) notFound();

  const tab: TabKey = (TABS.find((t) => t.key === searchParams?.tab)?.key ?? "overview") as TabKey;
  const trial = deriveTrialState(c, Date.now());
  const lc = lifecycleBadge(c.lifecycleStatus);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/companies" className="text-sm text-slate-400 hover:text-teal-300">
          ← Toutes les entreprises
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{c.displayName}</h1>
            <Badge label={lc.label} tone={lc.tone} />
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={c.slug ?? ""} label="Copier le slug" />
            <CopyButton value={c.id} label="Copier l'ID tenant" />
            <Link
              href={`/platform/companies/${c.id}?tab=rollout`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              Déploiement
            </Link>
          </div>
        </div>
        <p className="mt-1 font-mono text-xs text-slate-500">{c.slug ?? "—"} · {c.id}</p>

        {/* Lifecycle controls (6.0D). Only the transitions valid from the current status
            are shown; enforcement lives in getCurrentUser, so these buttons are real. */}
        {isLifecycleStatus(c.lifecycleStatus) && (
          <div className="mt-4">
            <LifecycleActions tenantId={c.id} status={c.lifecycleStatus} />
          </div>
        )}
      </div>

      <nav className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2" aria-label="Sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/platform/companies/${c.id}?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              t.key === tab ? "bg-teal-500 text-navy-950" : "text-slate-300 hover:bg-white/5",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab company={c} trialLabel={trialText(trial)} />}
      {tab === "branding" && <BrandingTab tenantId={c.id} />}
      {tab === "subscription" && <SubscriptionTab company={c} trialLabel={trialText(trial)} />}
      {tab === "users" && <UsersTab tenantId={c.id} />}
      {tab === "rollout" && <RolloutTab tenantId={c.id} />}
      {tab === "audit" && <AuditTab tenantId={c.id} page={Number(searchParams?.page ?? 1) || 1} />}
      {tab === "health" && <HealthTab company={c} tenantId={c.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- Overview ----
function OverviewTab({ company: c, trialLabel }: { company: CompanySummary; trialLabel: string }) {
  const ob = onboardingBadge(c.onboardingStatus);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Nom" value={c.displayName} />
      <Field label="Identifiant (slug)" value={c.slug ?? "—"} />
      <Field label="Plan" value={c.planKey ?? "—"} />
      <Field label="Statut" value={lifecycleBadge(c.lifecycleStatus).label} />
      <Field label="Essai" value={trialLabel} />
      <Field label="Onboarding" value={<Badge label={ob.label} tone={ob.tone} />} />
      <Field label="Administrateur" value={c.administratorEmail ?? "—"} />
      <Field label="Utilisateurs" value={String(c.userCount)} />
      <Field label="Dossiers actifs" value={String(c.activeDossierCount)} />
      <Field label="Pays / langue" value={`${c.country ?? "—"} · ${c.locale}`} />
      <Field label="Créée le" value={c.createdAt.slice(0, 10)} />
      <Field label="Dernière connexion" value={c.lastTenantLoginAt ? c.lastTenantLoginAt.slice(0, 16).replace("T", " ") : "—"} />
    </div>
  );
}

// ---------------------------------------------------------------- Branding ----
async function BrandingTab({ tenantId }: { tenantId: string }) {
  const b = await resolveTenantBranding(tenantId);
  return (
    <Panel title="Image de marque du tenant">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom d'affichage" value={b.displayName || "—"} />
        <Field label="Nom légal" value={b.legalName || "—"} />
        <Field label="E-mail de support" value={b.supportEmail || "—"} />
        <Field label="Téléphone de support" value={b.supportPhone || "—"} />
        <Field label="Couleur primaire" value={b.primaryColor || "—"} />
        <Field label="Couleur secondaire" value={b.secondaryColor || "—"} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Lecture seule. L'édition de la marque (logo, couleurs) n'est pas encore disponible dans la
        console plateforme.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- Subscription ----
function SubscriptionTab({ company: c, trialLabel }: { company: CompanySummary; trialLabel: string }) {
  const modules = c.planKey && isPlanKey(c.planKey) ? resolveTenantModules(c.planKey) : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Plan" value={c.planKey ?? "—"} />
        <Field label="Statut" value={lifecycleBadge(c.lifecycleStatus).label} />
        <Field label="Essai" value={trialLabel} />
        <Field label="Début d'essai" value={c.trialStartedAt ? c.trialStartedAt.slice(0, 10) : "—"} />
        <Field label="Fin d'essai" value={c.trialEndsAt ? c.trialEndsAt.slice(0, 10) : "—"} />
        <Field label="Utilisateurs" value={String(c.userCount)} />
      </div>
      <Panel title="Modules inclus (dérivés du plan)">
        <div className="flex flex-wrap gap-2">
          {modules.length === 0 ? (
            <span className="text-sm text-slate-500">Aucun</span>
          ) : (
            modules.map((m) => (
              <span key={m} className="rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-[13px] text-teal-200">
                {m.replace("module.", "")}
              </span>
            ))
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Aucune facturation n'est gérée par la plateforme à ce stade — plan et essai sont contractuels.
        </p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Users ----
async function UsersTab({ tenantId }: { tenantId: string }) {
  const users = await listCompanyUsers(tenantId);
  return (
    <Panel title={`Utilisateurs (${users.length})`}>
      {users.length === 0 ? (
        <p className="text-sm text-slate-400">Aucun utilisateur.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="text-left text-[12px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Utilisateur</th>
                <th className="px-3 py-2 font-semibold">Rôles</th>
                <th className="px-3 py-2 font-semibold">Statut</th>
                <th className="px-3 py-2 font-semibold">Dernière connexion</th>
                <th className="px-3 py-2 font-semibold">Créé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">
                    <span className="text-white">{u.name ?? u.email}</span>
                    {u.isSystemAdmin && <span className="ml-2 rounded bg-teal-400/15 px-1.5 py-0.5 text-[10px] font-bold text-teal-200">ADMIN</span>}
                    <span className="block text-xs text-slate-500">{u.email}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{u.roles.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{u.status}</td>
                  <td className="px-3 py-2 text-slate-400">{u.lastLoginAt ? u.lastLoginAt.slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{u.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Rollout ----
async function RolloutTab({ tenantId }: { tenantId: string }) {
  // Reuse the EXISTING rollout overview + controls. This tenant's row is selected from
  // the same bounded read the /platform/rollout page uses; no rollout logic is copied.
  const overview = await getRolloutOverview();
  const row = overview.rows.find((r) => r.tenantId === tenantId);
  if (!row) {
    return <Panel title="Déploiement du processus"><p className="text-sm text-slate-400">Aucune ligne de déploiement.</p></Panel>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Activez ou désactivez le processus officiel pour ce tenant. L'interrupteur global est{" "}
        <strong className={overview.killSwitch.enabled ? "text-emerald-300" : "text-amber-300"}>
          {overview.killSwitch.enabled ? "actif" : "coupé"}
        </strong>.
      </p>
      <RolloutControls row={row} killSwitchOn={overview.killSwitch.enabled} />
    </div>
  );
}

// ---------------------------------------------------------------- Audit ----
async function AuditTab({ tenantId, page }: { tenantId: string; page: number }) {
  const res = await listCompanyAuditEvents(tenantId, { page, pageSize: 25 });
  const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize));
  return (
    <Panel title={`Journal d'audit (${res.total})`}>
      {res.entries.length === 0 ? (
        <p className="text-sm text-slate-400">Aucun événement d'audit.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="text-left text-[12px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Acteur</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Cible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {res.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2 text-slate-300">{e.actorLabel}</td>
                    <td className="px-3 py-2 font-mono text-xs text-teal-200">{e.action}</td>
                    <td className="px-3 py-2 text-slate-400">{e.entity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pagination audit">
              <Link
                href={`/platform/companies/${tenantId}?tab=audit&page=${Math.max(1, page - 1)}`}
                aria-disabled={page <= 1}
                className={cn("rounded-lg border border-white/10 px-3 py-1.5 text-slate-200", page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white/5")}
              >
                Précédent
              </Link>
              <span className="text-slate-500">Page {res.page} / {totalPages}</span>
              <Link
                href={`/platform/companies/${tenantId}?tab=audit&page=${page + 1}`}
                aria-disabled={page >= totalPages}
                className={cn("rounded-lg border border-white/10 px-3 py-1.5 text-slate-200", page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-white/5")}
              >
                Suivant
              </Link>
            </nav>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Health ----
async function HealthTab({ company: c, tenantId }: { company: CompanySummary; tenantId: string }) {
  const overview = await getRolloutOverview();
  const row = overview.rows.find((r) => r.tenantId === tenantId);
  const live = row?.effective.process_engine ?? false;
  const health = deriveCompanyHealth(c, live);
  const hb = HEALTH_BADGES[health.level];

  const checks: { label: string; ok: boolean }[] = [
    { label: "Premier administrateur", ok: health.hasAdministrator },
    { label: "Onboarding terminé", ok: health.onboardingComplete },
    { label: "Image de marque configurée", ok: health.brandingComplete },
    { label: "Processus officiel activé", ok: health.rolloutLive },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge label={hb.label} tone={hb.tone} />
        <span className="text-sm text-slate-300">{health.summary}</span>
      </div>
      <Panel title="État de configuration">
        <ul className="space-y-2">
          {checks.map((ch) => (
            <li key={ch.label} className="flex items-center gap-2 text-sm">
              <span className={cn("inline-block h-2.5 w-2.5 rounded-full", ch.ok ? "bg-emerald-400" : "bg-slate-600")} />
              <span className={ch.ok ? "text-slate-200" : "text-slate-400"}>{ch.label}</span>
              <span className="ml-auto text-xs text-slate-500">{ch.ok ? "OK" : "à faire"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Ces indicateurs sont dérivés des données déjà disponibles (administrateur, onboarding,
          marque, déploiement). Aucun indicateur n'est fabriqué.
        </p>
      </Panel>
    </div>
  );
}
