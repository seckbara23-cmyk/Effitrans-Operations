"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  provisionMailbox, retryProvisioning, setMailboxEnabled, revokeMembership,
  setDepartmentEligibility, recordMailboxConfiguration, submitMailboxForVerification,
  recordVerificationOutcome, activateMailbox, recordLegacyActiveDecision,
} from "@/lib/ec/mailboxes/admin-actions";
import type { MailboxSummary, MailboxMember } from "@/lib/ec/mailboxes/membership";
import type { MailboxLifecycleView } from "@/lib/ec/mailboxes/lifecycle";
import { ACTION_FR, STATE_FR } from "@/lib/ec/mailboxes/lifecycle";
import {
  MAILBOX_PURPOSE_OPTIONS, purposeLabelFr, eligibilityLabelFr, ELIGIBILITY_OPTIONS,
  MAILBOX_TYPE_FR, MAILBOX_TYPE_MEANING_FR, OWNERSHIP_FR,
} from "@/lib/ec/mailboxes/vocabulary";
import { mailboxReadiness, readinessTone } from "@/lib/ec/mailboxes/readiness";
import { cn } from "@/lib/cn";

/**
 * EMP-4A / EMP-5E / EMP-5F — the mailbox administration panel.
 *
 * IT DECIDES NOTHING. Every lifecycle judgement — which actions are permitted,
 * what blocks activation, which readiness checks pass — is made on the server by
 * `lib/ec/mailboxes/lifecycle.ts` and arrives as a `MailboxLifecycleView`. A
 * component that re-derived those rules would be a second copy of them, and a
 * second copy is one that goes stale; it would also have to read its own clock,
 * and disagree with the server that runs the action.
 *
 * « Activer » IS ABSENT WHENEVER ACTIVATION WOULD FAIL, and the reasons are
 * shown in its place. A button that exists only to produce an error teaches
 * administrators that the rules are arbitrary.
 *
 * Two things it still deliberately does NOT show: any "Send As" control, and
 * any suggestion that provisioning contacts a provider. Every state here records
 * what a person did or reported, and says which evidence is manual.
 */
const ERRORS_FR: Record<string, string> = {
  forbidden: "Autorisation insuffisante.",
  address_taken: "Cette adresse est déjà utilisée par une boîte ou un alias.",
  invalid_address: "Adresse invalide.",
  owner_required: "Une boîte personnelle doit désigner son titulaire.",
  owner_not_allowed: "Une boîte partagée ou fonctionnelle n'a pas de titulaire.",
  not_failed: "Cette boîte n'est pas en échec.",
  invalid_state: "Cette étape n'est pas possible depuis l'état actuel.",
  not_revocable: "Cette appartenance est déjà révoquée.",
  provision_failed: "La réservation a échoué.",
  mailbox_not_found: "Boîte introuvable.",
  invalid_eligibility: "Département éligible inconnu.",
  personal_not_departmental:
    "Une boîte personnelle ne peut pas porter d'éligibilité départementale : "
    + "elle appartient à une personne, pas à un département.",
  update_failed: "La modification a échoué.",
  retry_failed: "La relance a échoué.",
  invalid_ownership: "Provenance invalide.",
  external_reference_required:
    "Indiquez le fournisseur ou l'identifiant externe : sans référence, « configurée » "
    + "ne désigne rien de vérifiable.",
  invalid_integration_address: "Adresse d'intégration invalide.",
  evidence_reference_required:
    "Une preuve doit pointer vers quelque chose de vérifiable (identifiant de message "
    + "fournisseur, événement de capture).",
  activation_requires_verification:
    "La mise en service passe par la vérification : utilisez « Activer » une fois la "
    + "boîte vérifiée.",
  activation_refused: "Mise en service refusée — voir les motifs ci-dessous.",
  not_legacy_active: "Cette boîte n'est pas en mise en service héritée.",
  reason_required: "Un motif est obligatoire.",
};

const LEGACY_DECISIONS: { value: string; label: string }[] = [
  { value: "CONFIRM_PERSONAL", label: "A — confirmer comme boîte personnelle d'entreprise" },
  { value: "CONFIRM_SHARED", label: "B — confirmer comme boîte partagée" },
  { value: "RECLASSIFY_FUNCTIONAL", label: "C — reclasser comme boîte fonctionnelle" },
  { value: "DISABLE_PENDING_VERIFICATION", label: "D — désactiver en attendant vérification" },
  { value: "KEEP_RESTRICTED", label: "E — conserver temporairement, en accès restreint" },
];

export function MailboxAdminPanel({
  mailboxes,
  views,
  selectedId,
  members,
  canProvision,
  canManageMembers,
}: {
  mailboxes: MailboxSummary[];
  /** Server-decided lifecycle view per mailbox id. */
  views: Record<string, MailboxLifecycleView>;
  selectedId: string | null;
  members: MailboxMember[];
  canProvision: boolean;
  canManageMembers: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPurpose, setNewPurpose] = useState("GENERAL");
  const [newType, setNewType] = useState<"SHARED" | "FUNCTIONAL">("SHARED");
  const [newEligibility, setNewEligibility] = useState("");
  // Configurer
  const [cfgOwnership, setCfgOwnership] = useState<"CORPORATE_EXISTING" | "PLATFORM_MANAGED">("CORPORATE_EXISTING");
  const [cfgProvider, setCfgProvider] = useState("");
  const [cfgExternalId, setCfgExternalId] = useState("");
  const [cfgIntegration, setCfgIntegration] = useState("");
  // Vérifier
  const [verCapability, setVerCapability] = useState<"IDENTITY" | "OUTBOUND" | "INBOUND">("IDENTITY");
  const [verRef, setVerRef] = useState("");
  // Legacy remediation
  const [legacyDecision, setLegacyDecision] = useState(LEGACY_DECISIONS[0].value);
  const [legacyReason, setLegacyReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERRORS_FR[res.error ?? ""] ?? `Échec : ${res.error}`);
    });
  };

  const selected = mailboxes.find((m) => m.id === selectedId) ?? null;
  const view = selected ? views[selected.id] : undefined;
  const notes = selected ? mailboxReadiness(selected) : [];
  const may = (a: string) => Boolean(view?.actions.includes(a as never));

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ---- mailbox list ---- */}
      <section className="surface overflow-hidden" aria-labelledby="mbx-list">
        <h2 id="mbx-list" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Boîtes
        </h2>
        {mailboxes.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Aucune boîte réservée.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mailboxes.map((m) => {
              const tone = readinessTone(mailboxReadiness(m));
              const v = views[m.id];
              return (
                <li key={m.id}>
                  <Link
                    href={`/admin/enterprise-mail/mailboxes?mailbox=${m.id}`}
                    className={cn(
                      "block px-4 py-3 hover:bg-slate-50",
                      m.id === selectedId && "bg-slate-50",
                    )}
                  >
                    <p className="truncate text-sm font-medium text-navy-900">
                      {tone === "warning" ? (
                        <span className="mr-1 text-amber-700" aria-label="À vérifier">▲</span>
                      ) : null}
                      {m.address}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {MAILBOX_TYPE_FR[m.mailboxType] ?? m.mailboxType} ·{" "}
                      {v?.stateFr ?? STATE_FR.RESERVED} ·{" "}
                      {m.activeMembers} membre{m.activeMembers > 1 ? "s" : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Éligible : {eligibilityLabelFr(m.departmentEligibility)}
                    </p>
                    {v?.legacyActive ? (
                      <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                        ▲ Active sans preuve de vérification
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {canProvision ? (
          <div className="space-y-2 border-t border-slate-100 p-4">
            <h3 className="text-xs font-semibold text-navy-900">1. Réserver une boîte</h3>
            <input
              value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
              placeholder="operations@exemple.sn"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
            <input
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Libellé"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />

            <label className="block text-[11px] text-slate-600">
              Type de boîte
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "SHARED" | "FUNCTIONAL")}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="SHARED">{MAILBOX_TYPE_FR.SHARED}</option>
                <option value="FUNCTIONAL">{MAILBOX_TYPE_FR.FUNCTIONAL}</option>
              </select>
            </label>
            <p className="text-[11px] text-slate-500">{MAILBOX_TYPE_MEANING_FR[newType]}</p>

            <label className="block text-[11px] text-slate-600">
              Usage de la boîte
              <select
                value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                {MAILBOX_PURPOSE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{purposeLabelFr(p)}</option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-slate-500">
              Étiquette descriptive : décrit à quoi sert la boîte. Sans effet sur les
              propositions automatiques.
            </p>

            <label className="block text-[11px] text-slate-600">
              Département éligible
              <select
                value={newEligibility} onChange={(e) => setNewEligibility(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                {ELIGIBILITY_OPTIONS.map((o) => (
                  <option key={o.value || "none"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-slate-500">
              Détermine quels employés sont <strong>proposés automatiquement</strong>.
              N&apos;accorde aucun accès par lui-même.
            </p>

            <button
              type="button"
              disabled={pending || !newAddress.trim()}
              onClick={() => run(() => provisionMailbox({
                address: newAddress, labelFr: newLabel, purpose: newPurpose,
                mailboxType: newType, departmentEligibility: newEligibility || null,
              }))}
              className="w-full rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {pending ? "…" : "Réserver l'identité interne"}
            </button>
            <p className="text-[11px] text-slate-500">
              La boîte est créée à l&apos;état <strong>Réservée</strong> : aucune affirmation
              n&apos;est faite sur l&apos;existence d&apos;une boîte chez le fournisseur.
            </p>
          </div>
        ) : null}
      </section>

      {/* ---- selected mailbox ---- */}
      <section className="surface p-4" aria-labelledby="mbx-detail">
        <h2 id="mbx-detail" className="mb-3 text-sm font-semibold text-navy-900">
          {selected ? selected.address : "Aucune boîte sélectionnée"}
        </h2>

        {selected && view ? (
          <>
            {/* ---- lifecycle stepper ---- */}
            <ol className="mb-4 flex flex-wrap gap-1 text-[11px]" aria-label="Cycle de vie">
              {([
                ["Réserver", ["RESERVED"]],
                ["Configurer", ["CONFIGURATION_REQUIRED", "CONFIGURED"]],
                ["Vérifier", ["PENDING_VERIFICATION", "VERIFIED"]],
                ["Activer", ["ACTIVE"]],
              ] as const).map(([label, states], i) => {
                const reached = states.includes(view.state as never)
                  || (["ACTIVE"].includes(view.state) && i < 3)
                  || (["VERIFIED", "PENDING_VERIFICATION"].includes(view.state) && i < 2)
                  || (["CONFIGURED", "CONFIGURATION_REQUIRED"].includes(view.state) && i < 1);
                const current = states.includes(view.state as never);
                return (
                  <li
                    key={label}
                    className={cn(
                      "rounded-full px-2.5 py-1",
                      current ? "bg-teal-600 font-semibold text-white"
                        : reached ? "bg-teal-50 text-teal-700"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {i + 1}. {label}
                  </li>
                );
              })}
            </ol>

            <dl className="grid gap-2 text-xs sm:grid-cols-3">
              <Fact label="État" value={view.stateFr} />
              <Fact label="Type" value={MAILBOX_TYPE_FR[selected.mailboxType] ?? selected.mailboxType} />
              <Fact label="Provenance" value={OWNERSHIP_FR[selected.ownership] ?? selected.ownership} />
              <Fact label="Usage de la boîte" value={purposeLabelFr(selected.purpose)} />
              <Fact label="Département éligible" value={eligibilityLabelFr(selected.departmentEligibility)} />
              <Fact label="Tentatives" value={String(selected.provisioningAttempts)} />
              <Fact
                label="Identité d'entreprise"
                value={view.capability.identityConfirmed ? "Confirmée" : "Non confirmée"}
              />
              <Fact label="Envoi" value={view.capability.outboundReady ? "Prêt" : "Non vérifié"} />
              <Fact label="Réception" value={view.capability.inboundReady ? "Prêt" : "Non vérifié"} />
              <Fact
                label="Dernière vérification"
                value={selected.corporateIdentityConfirmedAt
                  ? new Date(selected.corporateIdentityConfirmedAt).toLocaleDateString("fr-FR")
                  : "—"}
              />
              <Fact label="Vérificateur" value={selected.corporateIdentityConfirmedBy ? "Enregistré" : "—"} />
              <Fact
                label="Preuve"
                value={selected.outboundVerificationRef ?? selected.inboundVerificationRef ?? "—"}
              />
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">{view.meaningFr}</p>
            {selected.provisioningNote ? (
              <p className="mt-2 text-[11px] text-amber-800">{selected.provisioningNote}</p>
            ) : null}

            {/* ---- legacy-active remediation ---- */}
            {view.legacyActive ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <h3 className="text-xs font-semibold text-amber-900">
                  Mise en service héritée — classification à confirmer
                </h3>
                <p className="mt-1 text-[11px] text-amber-900">
                  Cette boîte est active mais n&apos;a jamais été vérifiée ni mise en service par
                  une personne identifiée. Elle n&apos;a été ni reclassée, ni désactivée, ni
                  modifiée : la plateforme enregistre une décision, elle ne la prend pas. Les
                  capacités qui exigent une preuve restent indisponibles.
                </p>
                {canProvision ? (
                  <div className="mt-2 space-y-2">
                    <select
                      value={legacyDecision} onChange={(e) => setLegacyDecision(e.target.value)}
                      className="w-full rounded-md border border-amber-200 px-2 py-1.5 text-xs"
                    >
                      {LEGACY_DECISIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                    <input
                      value={legacyReason} onChange={(e) => setLegacyReason(e.target.value)}
                      placeholder="Motif (obligatoire) — sur quel fait externe repose cette décision ?"
                      className="w-full rounded-md border border-amber-200 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button" disabled={pending || !legacyReason.trim()}
                      onClick={() => run(() => recordLegacyActiveDecision(
                        selected.id,
                        legacyDecision as "CONFIRM_PERSONAL",
                        legacyReason,
                      ))}
                      className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Enregistrer la décision (sans modifier la boîte)
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---- readiness checks ---- */}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <h3 className="text-xs font-semibold text-navy-900">Contrôles de disponibilité</h3>
              <ul className="mt-1 space-y-1">
                {view.checks.map((c) => (
                  <li key={c.code} className="text-[11px]">
                    <span className={c.passed ? "text-teal-700" : "text-slate-500"}>
                      {c.passed ? "✓" : "○"} {c.labelFr}
                    </span>
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                      {c.kind === "automated" ? "preuve automatique" : "preuve manuelle"}
                    </span>
                    <span className="block text-slate-400">{c.detailFr}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">
                Aucune intégration avec un fournisseur de messagerie n&apos;existe : la plateforme ne
                teste rien à distance et n&apos;affirme jamais l&apos;avoir fait.
              </p>
            </div>

            {/* ---- readiness notes ---- */}
            {notes.length > 0 ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold text-navy-900">État de préparation</h3>
                <ul className="mt-1 space-y-1">
                  {notes.map((n) => (
                    <li
                      key={n.code}
                      className={cn("text-[11px]",
                        n.severity === "warning" ? "text-amber-800" : "text-slate-500")}
                    >
                      {n.severity === "warning" ? "▲ " : "• "}{n.messageFr}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-400">
                  Ces constats sont descriptifs : aucun n&apos;a désactivé, modifié ou
                  reclassé cette boîte.
                </p>
              </div>
            ) : null}

            {/* ---- classification (EMP-5E) ---- */}
            {canProvision ? (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold text-navy-900">Département éligible</h3>
                <select
                  value={selected.departmentEligibility ?? ""}
                  disabled={pending}
                  onChange={(e) => run(() => setDepartmentEligibility(selected.id, e.target.value || null))}
                  className="w-full max-w-sm rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  {ELIGIBILITY_OPTIONS.map((o) => (
                    <option key={o.value || "none"} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Détermine uniquement quels employés sont <strong>proposés
                  automatiquement</strong> pour cette boîte. Choisir « Aucun » ne retire
                  aucun accès existant : les appartenances restent explicites, nominatives et
                  auditées, et seules une attribution ou une révocation les modifient.
                </p>
              </div>
            ) : null}

            {/* ---- lifecycle actions ---- */}
            {canProvision ? (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold text-navy-900">Cycle de vie</h3>

                {may("CONFIGURE") ? (
                  <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold text-navy-900">
                      2. {ACTION_FR.CONFIGURE}
                    </p>
                    <select
                      value={cfgOwnership}
                      onChange={(e) => setCfgOwnership(e.target.value as "CORPORATE_EXISTING")}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    >
                      <option value="CORPORATE_EXISTING">{OWNERSHIP_FR.CORPORATE_EXISTING}</option>
                      <option value="PLATFORM_MANAGED">{OWNERSHIP_FR.PLATFORM_MANAGED}</option>
                    </select>
                    <input
                      value={cfgProvider} onChange={(e) => setCfgProvider(e.target.value)}
                      placeholder="Fournisseur réel (ex. celui confirmé par l'informatique)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      value={cfgExternalId} onChange={(e) => setCfgExternalId(e.target.value)}
                      placeholder="Identifiant de la boîte chez le fournisseur (jamais un secret)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      value={cfgIntegration} onChange={(e) => setCfgIntegration(e.target.value)}
                      placeholder="Adresse d'intégration (copie), si la capture passe par une règle"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button" disabled={pending}
                      onClick={() => run(() => recordMailboxConfiguration(selected.id, {
                        ownership: cfgOwnership,
                        externalProvider: cfgProvider,
                        externalMailboxId: cfgExternalId,
                        integrationAddress: cfgIntegration,
                        note,
                      }))}
                      className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50"
                    >
                      {ACTION_FR.CONFIGURE}
                    </button>
                    <p className="text-[11px] text-slate-500">
                      Enregistre la relation fournisseur. Ne prouve pas que la boîte fonctionne,
                      et ne confirme pas son existence — c&apos;est l&apos;étape de vérification
                      qui le fait, et une autre personne devra ensuite l&apos;activer.
                    </p>
                  </div>
                ) : null}

                {may("SUBMIT_VERIFICATION") ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => run(() => submitMailboxForVerification(selected.id))}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50"
                  >
                    3. {ACTION_FR.SUBMIT_VERIFICATION}
                  </button>
                ) : null}

                {may("RECORD_VERIFICATION") ? (
                  <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold text-navy-900">
                      3. {ACTION_FR.RECORD_VERIFICATION}
                    </p>
                    <select
                      value={verCapability}
                      onChange={(e) => setVerCapability(e.target.value as "IDENTITY")}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    >
                      <option value="IDENTITY">Identité d&apos;entreprise (conditionne la mise en service)</option>
                      <option value="OUTBOUND">Envoi (capacité indépendante)</option>
                      <option value="INBOUND">Réception (capacité indépendante)</option>
                    </select>
                    <input
                      value={verRef} onChange={(e) => setVerRef(e.target.value)}
                      placeholder="Référence de preuve (identifiant de message, événement de capture)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="Note / motif"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button" disabled={pending}
                        onClick={() => run(() => recordVerificationOutcome(selected.id, {
                          capability: verCapability, passed: true, evidenceRef: verRef, note,
                        }))}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Vérification réussie
                      </button>
                      <button
                        type="button" disabled={pending || !note.trim()}
                        onClick={() => run(() => recordVerificationOutcome(selected.id, {
                          capability: verCapability, passed: false, evidenceRef: verRef, note,
                        }))}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Signaler un échec
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Preuve manuelle : la plateforme n&apos;observe rien chez le fournisseur.
                      La référence doit pointer vers un élément déjà enregistré ailleurs.
                    </p>
                  </div>
                ) : null}

                {may("ACTIVATE") ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => run(() => activateMailbox(selected.id))}
                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    4. {ACTION_FR.ACTIVATE}
                  </button>
                ) : view.blockers.length > 0 && view.state !== "ACTIVE" ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold text-navy-900">
                      Mise en service impossible pour l&apos;instant
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {view.blockers.map((b) => (
                        <li key={b.code} className="text-[11px] text-slate-600">• {b.messageFr}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {may("RETRY") ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => run(() => retryProvisioning(selected.id))}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50"
                  >
                    {ACTION_FR.RETRY}
                  </button>
                ) : null}

                {may("DEACTIVATE") ? (
                  <div className="space-y-1">
                    <button
                      type="button" disabled={pending}
                      onClick={() => run(() => setMailboxEnabled(selected.id, false))}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50"
                    >
                      {ACTION_FR.DEACTIVATE}
                    </button>
                    {/* The consequence, stated where the button is rather than
                        left to be discovered. */}
                    <p className="text-[11px] text-amber-800">
                      Les messages reçus ensuite seront mis en quarantaine : ils
                      n&apos;appartiendront à aucun tenant et ne seront visibles ni dans la
                      boîte ni dans le tri. L&apos;historique et les preuves de vérification
                      sont conservés.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---- members ---- */}
            <h3 className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold text-navy-900">
              Appartenances
            </h3>
            {!canManageMembers ? (
              <p className="mt-1 text-[11px] text-slate-500">
                La gestion des appartenances requiert une autorisation distincte.
              </p>
            ) : members.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">Aucun membre.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className={cn("text-sm text-navy-900", m.revokedAt && "text-slate-400 line-through")}>
                        {m.userName ?? m.userEmail}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {[m.canRead && "lecture", m.canSend && "envoi",
                          m.canManageMembers && "gestion", m.isDefaultSender && "expéditeur par défaut"]
                          .filter(Boolean).join(" · ") || "aucune capacité"}
                        {m.revokedAt ? ` · révoquée${m.revokeReason ? ` : ${m.revokeReason}` : ""}` : ""}
                      </p>
                    </div>
                    {!m.revokedAt ? (
                      <button type="button" disabled={pending}
                        onClick={() => run(() => revokeMembership(m.id, note || "révocation administrative"))}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-50">
                        Révoquer
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Sélectionnez une boîte à gauche.</p>
        )}

        {error ? <p className="mt-3 text-xs text-red-700" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
