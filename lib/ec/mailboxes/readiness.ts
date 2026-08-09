/**
 * EMP-5E — mailbox readiness. PURE, DESCRIPTIVE, and deliberately powerless.
 *
 * Every note here DESCRIBES a mailbox. None of them changes one, blocks one, or
 * disables one. That restraint is the design: EMP-5A/5B.1 found `ACTIVE` means
 * only "an operator asserted it", and the honest response to an unproven claim
 * is to say so where an administrator will read it — not to quietly deactivate
 * a mailbox the company may be using.
 *
 * Two of the sentences are named in the EMP-5E brief and appear verbatim:
 * « Classification à confirmer » and « Boîte active sans preuve de vérification ».
 *
 * MANUAL ASSIGNMENT IS NOT A DEFECT. A mailbox with no department eligibility
 * is a mailbox an administrator assigns by hand, which is a legitimate and
 * common arrangement — so it is `info`, never `warning`.
 */
import { canHoldDepartmentEligibility } from "./eligibility";
import { isLegacyActive } from "./lifecycle";

export type ReadinessSeverity = "info" | "warning";

export type ReadinessCode =
  | "LEGACY_ACTIVE_UNVERIFIED"
  | "OWNERSHIP_UNKNOWN"
  | "CORPORATE_IDENTITY_UNCONFIRMED"
  | "ACTIVE_WITHOUT_VERIFICATION"
  | "PERSONAL_LOOKING_ADDRESS"
  | "PERSONAL_WITH_ELIGIBILITY"
  | "ELIGIBILITY_ON_INACTIVE_MAILBOX"
  | "ELIGIBLE_BUT_UNVERIFIED"
  | "NO_DEPARTMENT_ELIGIBILITY"
  | "NO_MEMBERS";

export type ReadinessNote = {
  code: ReadinessCode;
  severity: ReadinessSeverity;
  /** The sentence an administrator reads. Descriptive, never an instruction. */
  messageFr: string;
};

/** The facts a readiness assessment needs. All already stored. */
export type ReadinessInput = {
  address: string;
  mailboxType: string;
  ownership: string;
  provisioningStatus: string;
  isActive: boolean;
  departmentEligibility: string | null;
  corporateIdentityConfirmedAt: string | null;
  outboundVerifiedAt: string | null;
  inboundVerifiedAt: string | null;
  activeMembers: number;
  /** EMP-5F — who put this mailbox into service through the governed lifecycle.
   *  NULL means nobody did, which is what legacy-unverified means. Optional so
   *  a caller reading a database that predates migration 20260819000001 still
   *  type-checks; absent reads as NULL, the safe direction. */
  activatedBy?: string | null;
};

/**
 * Local parts that name a function rather than a person.
 *
 * WHITELIST, NOT BLACKLIST — the same rule FIN-AGING-1 settled on. Trying to
 * detect "looks like a person's name" by pattern would flag `sav2024@` and miss
 * `direction.generale@`; listing the generic forms we recognise and treating
 * everything else as unrecognised is the direction that fails safely, because
 * the failure is a note an administrator reads and dismisses.
 */
const FUNCTIONAL_LOCAL_PARTS = new Set([
  "info", "contact", "accueil", "secretariat", "admin", "administration",
  "direction", "dg", "rh", "hr", "recrutement",
  "ops", "operations", "exploitation", "transit", "douane", "customs",
  "finance", "comptabilite", "compta", "facturation", "billing", "recouvrement",
  "commercial", "sales", "devis", "quotation", "quotes",
  "support", "sav", "reclamations", "service.client", "clients",
  "noreply", "no-reply", "notifications", "postmaster", "abuse",
  "logistique", "transport", "achats", "qhse", "hsse",
]);

function localPart(address: string): string {
  return (address ?? "").trim().toLowerCase().split("@")[0] ?? "";
}

/**
 * Assess one mailbox.
 *
 * DETERMINISTIC: the notes are emitted in the fixed order below and depend only
 * on the input, so two administrators looking at the same mailbox — and the
 * same administrator looking twice — see the identical list. Nothing consults a
 * clock, a random source or the database.
 */
export function mailboxReadiness(m: ReadinessInput): ReadinessNote[] {
  const notes: ReadinessNote[] = [];
  const add = (code: ReadinessCode, severity: ReadinessSeverity, messageFr: string) =>
    notes.push({ code, severity, messageFr });

  const verified = Boolean(m.outboundVerifiedAt) || Boolean(m.inboundVerifiedAt);
  const eligible = Boolean(m.departmentEligibility);
  const usable = m.provisioningStatus === "ACTIVE" && m.isActive;

  // 0. LEGACY-UNVERIFIED ACTIVE — first, because it is the strongest claim on
  //    the reader's attention: this mailbox is in operational use and never
  //    passed through the governed lifecycle at all. Distinct from the two
  //    notes below, which are about provenance and evidence: this one is about
  //    GOVERNANCE, and it is why the others cannot simply be assumed away.
  //
  //    DESCRIPTIVE, like everything here. Producing this note reclassified
  //    nothing, disabled nothing, and changed no field.
  if (isLegacyActive({ provisioningStatus: m.provisioningStatus, activatedBy: m.activatedBy ?? null })) {
    add("LEGACY_ACTIVE_UNVERIFIED", "warning",
      "Mise en service antérieure au cycle de vie gouverné : aucune personne "
      + "identifiée n'a activé cette boîte après vérification. Une décision "
      + "explicite est requise ; rien n'a été modifié automatiquement.");
  }

  // 1. Provenance. The one fact coexistence depends on, and the one EMP-5C
  //    refused to guess: UNKNOWN is the honest default, not a data error.
  if (m.ownership === "UNKNOWN") {
    add("OWNERSHIP_UNKNOWN", "warning",
      "Classification à confirmer — la provenance de cette adresse n'est pas établie "
      + "(gérée par la plateforme ou existante dans la messagerie d'entreprise).");
  }

  // 2. Claimed corporate, never confirmed. Only meaningful for a mailbox that
  //    CLAIMS to be corporate; a platform-managed one has no corporate identity
  //    to confirm, and an UNKNOWN one is already covered above.
  if (m.ownership === "CORPORATE_EXISTING" && !m.corporateIdentityConfirmedAt) {
    add("CORPORATE_IDENTITY_UNCONFIRMED", "warning",
      "Déclarée comme boîte d'entreprise existante, sans confirmation enregistrée.");
  }

  // 3. The EMP-5A finding, stated plainly. ACTIVE records a human assertion;
  //    these columns are where an OBSERVATION would be, and they are empty.
  if (usable && !verified) {
    add("ACTIVE_WITHOUT_VERIFICATION", "warning",
      "Boîte active sans preuve de vérification — aucun envoi ni aucune réception "
      + "n'a été observé par la plateforme.");
  }

  // 4. A personal-looking address classified as collective. Descriptive: the
  //    address alone decides nothing, it only raises the question.
  if (m.mailboxType !== "PERSONAL" && !FUNCTIONAL_LOCAL_PARTS.has(localPart(m.address))) {
    add("PERSONAL_LOOKING_ADDRESS", "warning",
      `Adresse au format nominatif classée « ${m.mailboxType === "FUNCTIONAL" ? "fonctionnelle" : "partagée"} » : `
      + "à confirmer avec le titulaire avant tout partage.");
  }

  // 5. A personal mailbox carrying a department eligibility. The write path
  //    refuses this, so it can only be a pre-existing row — hence a note rather
  //    than an impossibility.
  if (!canHoldDepartmentEligibility(m.mailboxType) && eligible) {
    add("PERSONAL_WITH_ELIGIBILITY", "warning",
      "Boîte personnelle portant une éligibilité départementale : une boîte "
      + "personnelle ne doit pas être proposée à un département entier.");
  }

  // 6. Eligible but unusable — it would be proposed while unable to serve.
  if (eligible && !usable) {
    add("ELIGIBILITY_ON_INACTIVE_MAILBOX", "warning",
      "Éligibilité départementale définie sur une boîte inactive.");
  }

  // 7. Eligible, usable, but nothing was ever observed to work.
  if (eligible && usable && !verified) {
    add("ELIGIBLE_BUT_UNVERIFIED", "warning",
      "Proposée automatiquement à un département alors qu'aucun fonctionnement "
      + "n'a été vérifié.");
  }

  // 8. INFO, and it stays info. Manual assignment is a choice, not a fault.
  if (!eligible && canHoldDepartmentEligibility(m.mailboxType)) {
    add("NO_DEPARTMENT_ELIGIBILITY", "info",
      "Aucune éligibilité départementale : cette boîte n'est proposée "
      + "automatiquement à personne et s'attribue manuellement.");
  }

  // 9. An active mailbox nobody can read is an operational gap; an inactive one
  //    without members is simply not in service yet.
  if (m.activeMembers === 0) {
    add("NO_MEMBERS", usable ? "warning" : "info",
      "Aucun membre actif : personne ne peut consulter cette boîte dans Effitrans.");
  }

  return notes;
}

/** The strongest severity present, for a list badge. */
export function readinessTone(notes: readonly ReadinessNote[]): ReadinessSeverity | null {
  if (notes.some((n) => n.severity === "warning")) return "warning";
  if (notes.length > 0) return "info";
  return null;
}
