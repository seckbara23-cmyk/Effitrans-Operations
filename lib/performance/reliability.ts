/**
 * D2 — the reliability status, after the coverage mechanism's retirement.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-08-28. The spreadsheet's < 80 % coverage → « Non classé » rung
 * existed to police manual cell completion; the platform populates those cells
 * itself, so the rung is retired. It is retired STRUCTURALLY: this function
 * takes no coverage input at all, so no caller can reintroduce the mechanism
 * without changing a signature a test pins.
 *
 * What survives is everything the mechanism merely resembled:
 *  - « < 10 dossiers → Provisoire » STAYS (GOV-06). It is statistical
 *    reliability of interpretation — ranking someone on three dossiers is not
 *    the same claim as ranking them on thirty — and has nothing to do with
 *    whether cells were filled.
 *  - « incident critique → Revue managériale » STAYS (GOV-09): an incident
 *    forces managerial review and blocks classification, whatever the volume.
 *  - « Classé only » ranking eligibility STAYS (GOV-10).
 *  - The duplicate-AM×month rung is superseded by construction: a database
 *    prevents duplicates with a uniqueness constraint, not a status label.
 *
 * There is deliberately NO « Non classé » value here — the only ladder value
 * whose sole producer was the retired coverage mechanism.
 */

/** GOV-06 — MIN_DOSSIERS, both workbooks agreed, kept by the D2 ruling. */
export const MIN_DOSSIERS = 10;

export type ReliabilityStatus =
  | "AUCUNE_DONNEE" // no dossiers in the period — nothing to interpret
  | "REVUE_MANAGERIALE" // critical incident — classification blocked pending review
  | "PROVISOIRE" // below MIN_DOSSIERS — interpret with reserve, never rank
  | "CLASSE"; // reliable — eligible for ranking

export type ReliabilityInput = {
  /** Dossiers attributable to the agent in the period. */
  dossierCount: number;
  /** GOV-09 — an open critical incident in the period. */
  criticalIncident: boolean;
};

export function reliabilityStatus(input: ReliabilityInput): ReliabilityStatus {
  if (input.dossierCount <= 0) return "AUCUNE_DONNEE";
  if (input.criticalIncident) return "REVUE_MANAGERIALE";
  if (input.dossierCount < MIN_DOSSIERS) return "PROVISOIRE";
  return "CLASSE";
}

/** GOV-10 — ranking is computed over CLASSE agents only. */
export function isRankable(status: ReliabilityStatus): boolean {
  return status === "CLASSE";
}
