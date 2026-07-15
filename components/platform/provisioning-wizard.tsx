"use client";

/**
 * Provisioning wizard (Phase 6.0B). CLIENT — thin shell over lib/.../wizard.ts.
 * ---------------------------------------------------------------------------
 * Collects a complete tenant draft entirely client-side and creates NOTHING until
 * the final confirmation. All logic (reducer, validation, input building, outcome
 * mapping) is in the pure module; this file is presentation + the single call to the
 * 6.0A provisionTenant() server action.
 *
 * IDEMPOTENCY / NO DOUBLE PROVISION. One provisioning key is minted per wizard run
 * (useRef, crypto.randomUUID) and reused across every retry, so a refresh, a rerender
 * or a double click that reaches the engine again gets already_exists, not a second
 * tenant. Submission is guarded three ways: a pending transition, a hard ref latch,
 * and a terminal "done" state that hides the button entirely once a tenant exists.
 *
 * THE SETUP LINK is shown once, in immediate state only. It is never written to the
 * URL, storage, logs or anywhere persistent — see how `outcome` lives only in React
 * state and is cleared on reset.
 */
import { useReducer, useRef, useState, useTransition, useId } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { provisionTenant, type ProvisionOutcome } from "@/lib/platform/provisioning/engine";
import { PLAN_KEYS } from "@/lib/platform/entitlements";
import { ROLLOUT_FEATURES } from "@/lib/process/rollout";
import {
  WIZARD_STEPS,
  STEP_COUNT,
  stepIndex,
  emptyDraft,
  draftReducer,
  draftToInput,
  validateStep,
  draftReadyToProvision,
  rolesForDraft,
  modulesForDraft,
  BUSINESS_PROFILE_LABELS,
  PLAN_LABELS,
  ERROR_MESSAGES,
  returnStepForError,
  type WizardStepKey,
} from "@/lib/platform/provisioning/wizard";
import type { BusinessProfileKey } from "@/lib/platform/role-templates";

const ROLLOUT_LABELS: Record<string, string> = {
  process_engine: "Moteur de processus",
  process_workspaces: "Espaces de travail",
  physical_invoice_deposit: "Dépôt physique de factures",
  collections: "Recouvrement",
};

// -------------------------------------------------------------- small UI ----

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium text-slate-200">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
      />
    </label>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
      {errors.map((e) => (
        <li key={e}>· {e}</li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------- wizard ----

export function ProvisioningWizard() {
  const router = useRouter();
  const [draft, dispatch] = useReducer(draftReducer, undefined, emptyDraft);
  const [current, setCurrent] = useState<WizardStepKey>("identity");
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<ProvisionOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  // ONE key per wizard run. Stable across every rerender and retry; a brand-new
  // wizard (reset) mints a fresh one. Never regenerated silently mid-run.
  const keyRef = useRef<string>(crypto.randomUUID());
  // Hard latch against the same submit racing itself before `pending` flips.
  const inFlight = useRef(false);

  const idx = stepIndex(current);
  const isReview = current === "review";
  const set = (field: keyof typeof draft) => (v: string) => dispatch({ type: "set", field, value: v });

  function goNext() {
    const errs = validateStep(draft, current);
    setStepErrors(errs);
    if (errs.length > 0) return;
    if (idx < STEP_COUNT - 1) setCurrent(WIZARD_STEPS[idx + 1].key);
  }
  function goBack() {
    setStepErrors([]);
    if (idx > 0) setCurrent(WIZARD_STEPS[idx - 1].key);
  }

  function doProvision() {
    if (inFlight.current || outcome?.ok) return; // latch + terminal guard
    inFlight.current = true;
    setConfirmOpen(false);
    startTransition(async () => {
      const input = draftToInput(draft, keyRef.current);
      // Operational events only — slug and status/error, never the setup link or any
      // secret (the allowed vocabulary from the brief).
      console.info("[provisioning] started", { slug: input.company.slug });
      const res = await provisionTenant(input);
      setOutcome(res);
      if (res.ok) {
        console.info("[provisioning] completed", { status: res.result.status });
      } else {
        console.info("[provisioning] failed", { error: res.error });
        // Route the admin to the step that owns the failure, draft intact.
        setCurrent(returnStepForError(res.error));
      }
      inFlight.current = false;
    });
  }

  function resetWizard() {
    dispatch({ type: "reset" });
    setCurrent("identity");
    setStepErrors([]);
    setOutcome(null);
    keyRef.current = crypto.randomUUID(); // a completely new wizard → a new key
  }

  // A successful (or already_exists) provision is terminal: show the result, no
  // way back to the form for this run.
  if (outcome?.ok) {
    return <SuccessView outcome={outcome} onNew={resetWizard} onList={() => router.push("/platform/companies")} onDetail={() => router.push(`/platform/companies/${outcome.result.organizationId}`)} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Stepper current={idx} />

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">{WIZARD_STEPS[idx].label}</h2>

        {outcome && !outcome.ok && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
            {ERROR_MESSAGES[outcome.error]}
          </div>
        )}

        <div className="space-y-4">
          {current === "identity" && <IdentityStep draft={draft} set={set} />}
          {current === "profile" && <ProfileStep draft={draft} dispatch={dispatch} set={set} />}
          {current === "branding" && <BrandingStep draft={draft} set={set} />}
          {current === "modules" && <ModulesStep draft={draft} dispatch={dispatch} />}
          {current === "roles" && <RolesStep draft={draft} />}
          {current === "administrator" && <AdministratorStep draft={draft} set={set} />}
          {current === "review" && <ReviewStep draft={draft} />}
        </div>

        <div className="mt-4">
          <ErrorList errors={stepErrors} />
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={idx === 0 || pending}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40"
          >
            Précédent
          </button>

          {!isReview ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400"
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={pending || !draftReadyToProvision(draft, keyRef.current)}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:opacity-40"
            >
              {pending ? "Provisionnement…" : "Provisionner l'entreprise"}
            </button>
          )}
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          slug={draft.slug}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doProvision}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------- stepper ----

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Étapes">
      {WIZARD_STEPS.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            i === current
              ? "bg-teal-500 text-navy-950"
              : i < current
                ? "bg-teal-500/20 text-teal-300"
                : "bg-white/5 text-slate-400",
          )}
        >
          <span className="tabular">{i + 1}</span>
          <span className="hidden sm:inline">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// -------------------------------------------------------------- steps ----

type SetFn = (field: keyof ReturnType<typeof emptyDraft>) => (v: string) => void;
type Draft = ReturnType<typeof emptyDraft>;

function IdentityStep({ draft, set }: { draft: Draft; set: SetFn }) {
  return (
    <>
      <Field label="Raison sociale" value={draft.legalName} onChange={set("legalName")} required placeholder="Northwind Logistics SA" />
      <Field label="Nom commercial" value={draft.tradeName} onChange={set("tradeName")} placeholder="Northwind" />
      <Field label="Identifiant (slug)" value={draft.slug} onChange={set("slug")} required placeholder="northwind" />
      <p className="text-xs text-slate-500">
        3–40 caractères : lettres minuscules, chiffres et tirets. Deviendra le sous-domaine du tenant.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Pays" value={draft.country} onChange={set("country")} required />
        <Field label="Langue" value={draft.language} onChange={set("language")} required />
        <Field label="Fuseau horaire" value={draft.timezone} onChange={set("timezone")} required />
        <Field label="Devise" value={draft.currency} onChange={set("currency")} />
      </div>
    </>
  );
}

function ProfileStep({ draft, dispatch, set }: { draft: Draft; dispatch: React.Dispatch<import("@/lib/platform/provisioning/wizard").WizardAction>; set: SetFn }) {
  return (
    <>
      <p className="text-sm text-slate-400">
        Le profil métier détermine les rôles opérationnels provisionnés (étape Rôles).
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(BUSINESS_PROFILE_LABELS) as BusinessProfileKey[]).map((k) => (
          <label key={k} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={draft.businessProfile[k]}
              onChange={() => dispatch({ type: "toggleProfile", key: k })}
              className="h-4 w-4 rounded border-white/20 bg-white/10"
            />
            {BUSINESS_PROFILE_LABELS[k]}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 pt-2">
        <Field label="E-mail de l'entreprise" value={draft.companyEmail} onChange={set("companyEmail")} type="email" />
        <Field label="Téléphone" value={draft.companyPhone} onChange={set("companyPhone")} />
        <Field label="NINEA" value={draft.ninea} onChange={set("ninea")} />
        <Field label="RCCM" value={draft.rccm} onChange={set("rccm")} />
      </div>
    </>
  );
}

function BrandingStep({ draft, set }: { draft: Draft; set: SetFn }) {
  return (
    <>
      <p className="text-sm text-slate-400">
        L'entreprise reçoit une image de marque par défaut au provisionnement. La personnalisation
        complète (logo, couleurs) se fait ensuite dans la fiche entreprise.
      </p>
      <Field label="Nom d'affichage" value={draft.tradeName} onChange={set("tradeName")} placeholder={draft.legalName || "Northwind"} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="E-mail de support" value={draft.companyEmail} onChange={set("companyEmail")} type="email" />
        <Field label="Téléphone de support" value={draft.companyPhone} onChange={set("companyPhone")} />
      </div>
      <p className="text-xs text-slate-500">
        Ces valeurs initialisent l'e-mail et le téléphone de support de la marque du tenant.
      </p>
    </>
  );
}

function ModulesStep({ draft, dispatch }: { draft: Draft; dispatch: React.Dispatch<import("@/lib/platform/provisioning/wizard").WizardAction> }) {
  return (
    <>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-200">Abonnement</p>
        <div className="flex gap-2">
          {PLAN_KEYS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => dispatch({ type: "setPlan", plan: p })}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium",
                draft.plan === p
                  ? "border-teal-400 bg-teal-500/15 text-teal-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
              )}
            >
              {PLAN_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Modules inclus : {modulesForDraft(draft).map((m) => m.replace("module.", "")).join(", ")}</p>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
        <p className="text-sm font-medium text-amber-200">Déploiement du processus — désactivé au départ</p>
        <p className="mt-1 text-xs text-slate-400">
          Les quatre fonctionnalités ci-dessous sont créées <strong>désactivées</strong>. Un administrateur
          plateforme les activera plus tard depuis la console de déploiement, tenant par tenant.
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-1.5">
          {ROLLOUT_FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-600" />
              {ROLLOUT_LABELS[f] ?? f} — OFF
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function RolesStep({ draft }: { draft: Draft }) {
  const roles = rolesForDraft(draft);
  return (
    <>
      <p className="text-sm text-slate-400">
        {roles.length} rôle(s) seront provisionnés selon le profil métier. SYSTEM_ADMIN est toujours inclus.
      </p>
      <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
        {roles.map((r) => (
          <li key={r.key} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-slate-200">{r.labelFr}</span>
            <span className="text-xs text-slate-500">
              {r.permissionCount} permission(s){r.required && " · requis"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function AdministratorStep({ draft, set }: { draft: Draft; set: SetFn }) {
  return (
    <>
      <p className="text-sm text-slate-400">
        Le premier administrateur reçoit un lien sécurisé pour définir son mot de passe. Aucun mot de
        passe n'est jamais créé ni affiché ici.
      </p>
      <Field label="Nom complet" value={draft.adminFullName} onChange={set("adminFullName")} required placeholder="Awa Ba" />
      <Field label="E-mail" value={draft.adminEmail} onChange={set("adminEmail")} required type="email" placeholder="awa@northwind.sn" />
      <Field label="Téléphone" value={draft.adminPhone} onChange={set("adminPhone")} />
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1.5 text-sm">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-100">{value || "—"}</dd>
    </div>
  );
}

function ReviewStep({ draft }: { draft: Draft }) {
  const profiles = (Object.keys(BUSINESS_PROFILE_LABELS) as BusinessProfileKey[])
    .filter((k) => draft.businessProfile[k])
    .map((k) => BUSINESS_PROFILE_LABELS[k]);
  const roles = rolesForDraft(draft);
  return (
    <dl>
      <ReviewRow label="Raison sociale" value={draft.legalName} />
      <ReviewRow label="Nom commercial" value={draft.tradeName} />
      <ReviewRow label="Identifiant" value={draft.slug} />
      <ReviewRow label="Pays / langue / fuseau" value={`${draft.country} · ${draft.language} · ${draft.timezone}`} />
      <ReviewRow label="Profil métier" value={profiles.join(", ") || "aucun"} />
      <ReviewRow label="Abonnement" value={PLAN_LABELS[draft.plan]} />
      <ReviewRow label="Rôles" value={`${roles.length} (dont SYSTEM_ADMIN)`} />
      <ReviewRow label="Administrateur" value={`${draft.adminFullName} · ${draft.adminEmail}`} />
      <ReviewRow label="Déploiement" value="Toutes les fonctionnalités désactivées" />
      <p className="mt-3 text-xs text-slate-500">
        À la confirmation, l'entreprise, ses rôles, son administrateur et son audit seront créés en une
        seule transaction. L'administrateur recevra un lien d'installation sécurisé.
      </p>
    </dl>
  );
}

// -------------------------------------------------------------- dialog ----

function ConfirmDialog({ slug, onCancel, onConfirm }: { slug: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-navy-950 p-6">
        <h3 className="text-lg font-semibold text-white">Confirmer le provisionnement</h3>
        <p className="mt-2 text-sm text-slate-400">
          Créer l'entreprise « {slug} » ? Cette action crée des enregistrements réels et envoie une
          invitation à l'administrateur.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400">
            Provisionner
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- success ----

function SuccessView({
  outcome,
  onNew,
  onList,
  onDetail,
}: {
  outcome: Extract<ProvisionOutcome, { ok: true }>;
  onNew: () => void;
  onList: () => void;
  onDetail: () => void;
}) {
  const { result, invitation } = outcome;
  const alreadyExisted = result.status === "already_exists";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className={cn("rounded-xl border p-6", alreadyExisted ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
        <h2 className="text-xl font-bold text-white">
          {alreadyExisted ? "Entreprise déjà provisionnée" : "Entreprise provisionnée"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {alreadyExisted
            ? "Une entreprise avec cette clé existe déjà. Aucun doublon n'a été créé."
            : "L'entreprise, ses rôles, son administrateur et son audit ont été créés."}
        </p>

        <dl className="mt-4">
          <ReviewRow label="Identifiant" value={result.tenantId} />
          <ReviewRow label="Administrateur" value={result.administratorLogin} />
          <ReviewRow label="Rôles créés" value={String(result.createdRoles.length)} />
          <ReviewRow label="Statut" value={result.status} />
        </dl>
      </div>

      <InvitationPanel invitation={invitation} />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onDetail} className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400">
          Ouvrir la fiche entreprise
        </button>
        <button type="button" onClick={onList} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">
          Liste des entreprises
        </button>
        <button type="button" onClick={onNew} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">
          Nouvelle entreprise
        </button>
      </div>
    </div>
  );
}

function InvitationPanel({ invitation }: { invitation: Extract<ProvisionOutcome, { ok: true }>["invitation"] }) {
  const [copied, setCopied] = useState(false);

  if (invitation.kind === "email_sent") {
    return (
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-emerald-200">
        L'e-mail d'installation sécurisé a été envoyé à l'administrateur.
      </div>
    );
  }

  if (invitation.kind === "failed") {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-200">
        L'entreprise a été créée, mais l'invitation n'a pas pu être générée. Vous pourrez la renvoyer
        depuis la fiche entreprise.
      </div>
    );
  }

  // link_returned — no email provider. Show the one-time link, prominently.
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="text-sm font-semibold text-amber-100">Lien d'installation à usage unique</p>
      <p className="mt-1 text-xs text-amber-200/80">
        Aucun service d'e-mail n'est configuré : l'e-mail n'a <strong>pas</strong> été envoyé.
        Transmettez ce lien à l'administrateur de façon sécurisée. Il ne sera plus affiché après avoir
        quitté cette page — un rafraîchissement le perd.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-black/40 px-2 py-1.5 text-xs text-amber-100">
          {invitation.setupLink}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(invitation.setupLink);
            setCopied(true);
          }}
          className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-navy-950 hover:bg-amber-300"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
    </div>
  );
}
