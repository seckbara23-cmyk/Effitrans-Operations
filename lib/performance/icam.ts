/**
 * ICAM — Indicateur de Charge Account Manager. The frozen engine.
 * ---------------------------------------------------------------------------
 * `ICAM = ICAM_BASE + Σ MIN(COEF_x × N(count_x), PLAFOND_x)`  (AM-S01..S09)
 *
 * A WORKLOAD indicator: eight capped counts of work an Account Manager did on a
 * dossier, over a base of 1,00, with a hard ceiling of 8,00. It is not a
 * quality score, not a penalty, not a percentage, not IPAM. An earlier audit
 * document said otherwise and was wrong; the frozen register (AM-S01..S09) is
 * the authority and this file implements exactly it.
 *
 * COMPLETENESS IS PART OF THE RESULT, not a footnote. Three of the eight terms
 * have no authoritative source yet (NREP, NPAY, NCOORD) and one has no register
 * at all (NINC). The arithmetic must treat an unavailable term as contributing
 * zero — there is nothing else it could do — but a zero CONTRIBUTION and a
 * measured zero COUNT are different facts about the business, and conflating
 * them is how an understated indicator gets published as a complete one. So
 * every term carries its own state, and the dossier result says plainly whether
 * its basis is complete.
 *
 * Parity: F-ICAM-01 (§7.4 example → 4,45) · F-ICAM-02 (base only → 1,00) ·
 * F-ICAM-03 (all caps saturated → 8,00) · F-ICAM-04 (individual caps).
 */

/** The eight components, in the register's order (AM-S01..S08). */
export const ICAM_TERMS = [
  "NDOC",
  "NREP",
  "NAD",
  "NPAY",
  "NFACT",
  "NCOORD",
  "NINC",
  "NCOUR",
] as const;
export type IcamTerm = (typeof ICAM_TERMS)[number];

/** Base charge every dossier carries (§7.3). */
export const ICAM_BASE = 1.0;

/** The per-dossier ceiling: base + every cap = 8,00 (F-ICAM-03). */
export const ICAM_MAX = 8.0;

/** Frozen coefficients and plafonds (§7.2). Never edit without a ratification. */
export const ICAM_COEFFICIENTS: Record<IcamTerm, { coef: number; cap: number; labelFr: string }> = {
  NDOC: { coef: 0.1, cap: 1.0, labelFr: "Documents contrôlés et classés" },
  NREP: { coef: 0.15, cap: 0.75, labelFr: "Reportings formels" },
  NAD: { coef: 0.25, cap: 1.0, labelFr: "Autorisations de dépense" },
  NPAY: { coef: 0.3, cap: 0.9, labelFr: "Paiements en ligne" },
  NFACT: { coef: 0.15, cap: 0.75, labelFr: "Factures fournisseurs contrôlées" },
  NCOORD: { coef: 0.3, cap: 1.2, labelFr: "Coordinations documentées" },
  NINC: { coef: 0.5, cap: 1.0, labelFr: "Retours non imputables traités" },
  NCOUR: { coef: 0.2, cap: 0.4, labelFr: "Récupérations physiques" },
};

/**
 * Why a term's count is what it is.
 *
 * `COUNTED` — the platform holds an authoritative source and counted it. Zero
 *             here is a MEASURED zero: the work did not happen.
 * `SOURCE_UNAVAILABLE` — no authoritative source exists yet, so the platform
 *             does not know. The term contributes 0 arithmetically because the
 *             formula has no other option, and `count` is NULL because the
 *             platform is not entitled to assert a number.
 * `NOT_ATTRIBUTABLE` — a source exists and events were found, but their
 *             activity instant is not persisted, so they cannot be attributed
 *             to the Account Manager who owned the dossier at the time. Under
 *             the Q9 ruling these are excluded rather than guessed.
 */
export type IcamTermState = "COUNTED" | "SOURCE_UNAVAILABLE" | "NOT_ATTRIBUTABLE";

export type IcamTermResult = {
  term: IcamTerm;
  labelFr: string;
  state: IcamTermState;
  /** NULL when the platform cannot honestly assert a count. */
  count: number | null;
  coefficient: number;
  cap: number;
  /** `MIN(coef × count, cap)`, or 0 when there is nothing to contribute. */
  contribution: number;
  /** Events found but excluded for want of a persisted activity instant. */
  unattributable?: number;
};

export type IcamDossierResult = {
  /** ICAM_BASE + Σ contributions, rounded to the cent, ceiling 8,00. */
  icam: number;
  terms: IcamTermResult[];
  /** True only when every one of the eight terms was actually COUNTED. */
  basisComplete: boolean;
  /** The terms that could not be counted, for disclosure. */
  unavailableTerms: IcamTerm[];
};

/** Counts per term. `null` means "no authoritative source", never "zero". */
export type IcamCounts = Partial<Record<IcamTerm, number | null>> & {
  /** Per-term events dropped for want of an activity instant (Q9). */
  unattributable?: Partial<Record<IcamTerm, number>>;
};

/** Excel ROUND (half away from zero), 2 decimals — the workbook's own. */
function round2(x: number): number {
  return Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100;
}

/**
 * Compute one dossier's ICAM.
 *
 * A term absent from `counts`, or present as `null`, is SOURCE_UNAVAILABLE: the
 * platform does not know, and says so. A term present as a number — including
 * `0` — is COUNTED, and zero means the work genuinely did not happen.
 */
export function computeIcamDossier(counts: IcamCounts): IcamDossierResult {
  const terms: IcamTermResult[] = ICAM_TERMS.map((term) => {
    const { coef, cap, labelFr } = ICAM_COEFFICIENTS[term];
    const raw = counts[term];
    const dropped = counts.unattributable?.[term] ?? 0;

    if (raw === null || raw === undefined) {
      return {
        term,
        labelFr,
        state: dropped > 0 ? "NOT_ATTRIBUTABLE" : "SOURCE_UNAVAILABLE",
        count: null,
        coefficient: coef,
        cap,
        contribution: 0,
        ...(dropped > 0 ? { unattributable: dropped } : {}),
      };
    }

    // N() coercion: a negative count is not a business fact, it is a bug.
    const n = Math.max(0, raw);
    return {
      term,
      labelFr,
      state: "COUNTED",
      count: n,
      coefficient: coef,
      cap,
      contribution: round2(Math.min(coef * n, cap)),
      ...(dropped > 0 ? { unattributable: dropped } : {}),
    };
  });

  const total = round2(terms.reduce((a, t) => a + t.contribution, ICAM_BASE));
  const unavailableTerms = terms.filter((t) => t.state !== "COUNTED").map((t) => t.term);

  return {
    // The ceiling is arithmetically unreachable (base + every cap = 8,00
    // exactly), so this clamp asserts the invariant rather than shaping data.
    icam: Math.min(total, ICAM_MAX),
    terms,
    basisComplete: unavailableTerms.length === 0,
    unavailableTerms,
  };
}
