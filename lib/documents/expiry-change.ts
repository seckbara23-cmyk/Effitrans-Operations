/**
 * Governed expiry-date changes (CEO-ALIGNMENT WP1-E) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * CEO-010: « Le declarant doit pouvoir inscrire ou mettre a jour les dates
 * d'echeances des documents (ex ; Dpi, Titre d'exo, sommiers etc.) »
 *
 * TWO TIERS, decided by the document's status, mirrored from the database:
 *
 *   DIRECT    an UNVERIFIED document (uploaded, under review, rejected): the
 *             change applies at once, with a mandatory reason, and is recorded.
 *   PROPOSAL  a VERIFIED document is approved evidence: the change is only
 *             PROPOSED, and an independent `document:approve` holder — never
 *             the proposer — confirms or rejects it. The status never moves.
 *
 * The database is the authority (record_/decide_document_expiry_change and the
 * trg_document_expiry_governed trigger, migration #161). This module only lets
 * the screen say the same thing before the server is asked, and turns the
 * RPCs' result codes into French.
 *
 * No validity durations live here: how long a DPI or a titre d'exonération is
 * valid is DEC-CEO-04/05, the Chef de Transit's to give.
 */

/** Statuses whose expiry change needs an independent confirmation. */
export const EXPIRY_PROPOSAL_STATUSES: readonly string[] = [
  "VERIFIED",
  "APPROVED", // legacy alias of VERIFIED
  "CONSUMED_AS_EVIDENCE",
  "EXPIRED",
];

export type ExpiryTier = "DIRECT" | "PROPOSAL" | "CLOSED";

/** Mirrors the RPC: superseded → nothing; verified → proposal; else direct. */
export function expiryTierFor(status: string): ExpiryTier {
  if (status === "SUPERSEDED") return "CLOSED";
  return EXPIRY_PROPOSAL_STATUSES.includes(status) ? "PROPOSAL" : "DIRECT";
}

export const MAX_EXPIRY_REASON = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExpiryRequestCheck =
  | { ok: true; expiryDate: string | null; reason: string }
  | { ok: false; error: string };

/**
 * Validate a request before the round trip. `expiryDate` null means « clear the
 * date », which the database refuses for a validity-bearing type.
 */
export function validateExpiryRequest(input: {
  expiryDate: string | null | undefined;
  reason: string | null | undefined;
}): ExpiryRequestCheck {
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim();
  if (reason === "") return { ok: false, error: "reason_required" };
  if (reason.length > MAX_EXPIRY_REASON) return { ok: false, error: "reason_too_long" };
  const raw = (input.expiryDate ?? "").trim();
  if (raw === "") return { ok: true, expiryDate: null, reason };
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    return { ok: false, error: "invalid_expiry_date" };
  }
  return { ok: true, expiryDate: raw, reason };
}

export type ExpiryDecision = "CONFIRMED" | "REJECTED";

export function validateExpiryDecision(input: {
  decision: string;
  reason: string | null | undefined;
}): { ok: true; decision: ExpiryDecision; reason: string | null } | { ok: false; error: string } {
  if (input.decision !== "CONFIRMED" && input.decision !== "REJECTED") {
    return { ok: false, error: "invalid_decision" };
  }
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim();
  if (input.decision === "REJECTED" && reason === "") return { ok: false, error: "reason_required" };
  if (reason.length > MAX_EXPIRY_REASON) return { ok: false, error: "reason_too_long" };
  return { ok: true, decision: input.decision, reason: reason === "" ? null : reason };
}

/** The operator-facing sentence for every outcome the actions can return. */
export const EXPIRY_MESSAGES_FR: Readonly<Record<string, string>> = {
  applied: "Échéance mise à jour.",
  proposed: "Nouvelle échéance proposée : elle s'appliquera après confirmation par un autre vérificateur.",
  confirmed: "Échéance confirmée et appliquée.",
  rejected: "Proposition d'échéance refusée.",
  forbidden: "Action non autorisée.",
  not_available: "La modification des échéances n'est pas encore disponible sur cette plateforme.",
  not_found: "Document introuvable.",
  reason_required: "Indiquez le motif de la modification.",
  reason_too_long: "Le motif ne peut pas dépasser 500 caractères.",
  invalid_expiry_date: "Date d'échéance invalide.",
  expiry_required: "La date d'échéance est obligatoire pour ce type de document.",
  expiry_unchanged: "L'échéance est déjà à cette valeur.",
  document_superseded: "Cette version a été remplacée : modifiez l'échéance sur la version en vigueur.",
  proposal_pending: "Une proposition d'échéance attend déjà une décision sur ce document.",
  self_approval_forbidden: "Vous ne pouvez pas confirmer votre propre proposition.",
  already_decided: "Cette proposition a déjà été traitée.",
  proposal_stale:
    "Cette proposition ne peut plus être confirmée : l'échéance ou la vérification du document a changé depuis. Refusez-la pour la clore.",
  invalid_decision: "Décision invalide.",
  generic: "La modification n'a pas pu être enregistrée.",
};

export function expiryMessageFr(code: string): string {
  return EXPIRY_MESSAGES_FR[code] ?? EXPIRY_MESSAGES_FR.generic;
}

/** One line of the history shown under a document. */
export type ExpiryHistoryEntry = {
  id: string;
  kind: "APPLIED" | "PROPOSED" | "CONFIRMED" | "REJECTED";
  oldExpiry: string | null;
  newExpiry: string | null;
  reason: string | null;
  actorId: string;
  actorEmail: string | null;
  occurredAt: string;
};

/** The open proposal on a document, if any. */
export type ExpiryProposal = {
  id: string;
  oldExpiry: string | null;
  newExpiry: string | null;
  reason: string | null;
  proposerId: string;
  proposerEmail: string | null;
  occurredAt: string;
};

const KIND_FR: Record<ExpiryHistoryEntry["kind"], string> = {
  APPLIED: "Échéance modifiée",
  PROPOSED: "Échéance proposée",
  CONFIRMED: "Échéance confirmée",
  REJECTED: "Proposition refusée",
};

/** « Échéance modifiée le 2026-10-21 par x@y — 2026-12-31 → 2027-06-30 — motif » */
export function expiryHistoryLineFr(e: ExpiryHistoryEntry): string {
  const when = e.occurredAt.slice(0, 10);
  const who = e.actorEmail ?? "—";
  const move = `${e.oldExpiry ?? "aucune"} → ${e.newExpiry ?? "aucune"}`;
  return [`${KIND_FR[e.kind]} le ${when} par ${who}`, move, e.reason].filter(Boolean).join(" — ");
}

/**
 * Pair history rows into « recent entries » and « the open proposal ». A
 * proposal is open while no CONFIRMED/REJECTED row points at it.
 */
export function summarizeExpiryHistory(
  rows: readonly (ExpiryHistoryEntry & { proposalId: string | null })[],
): { recent: ExpiryHistoryEntry[]; pending: ExpiryProposal | null } {
  const decided = new Set(rows.filter((r) => r.proposalId).map((r) => r.proposalId as string));
  const open = rows.find((r) => r.kind === "PROPOSED" && !decided.has(r.id)) ?? null;
  const sorted = [...rows].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  return {
    recent: sorted.slice(0, 3).map(({ proposalId: _p, ...e }) => e),
    pending: open
      ? {
          id: open.id,
          oldExpiry: open.oldExpiry,
          newExpiry: open.newExpiry,
          reason: open.reason,
          proposerId: open.actorId,
          proposerEmail: open.actorEmail,
          occurredAt: open.occurredAt,
        }
      : null,
  };
}
