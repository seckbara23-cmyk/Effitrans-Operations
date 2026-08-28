/**
 * The management report snapshot — what publication freezes.
 * ---------------------------------------------------------------------------
 * Facts, not a copy of the business. Everything here is something management
 * actually read on the page: the totals, the per-collaborateur rows, the
 * reliability markers, and the notes that say how far the data can be trusted.
 * No dossier, document or customs record is duplicated.
 *
 * `PARAMETER_SET_VERSION` is stamped on every snapshot. Exactly one parameter
 * set has ever existed, so a version LABEL is the whole of what the platform
 * needs today: an effective-dated parameter table would be structure built for
 * a second version that cannot yet exist, and Paramètres refuses editing
 * precisely because that version does not exist. When it does, this label is
 * what a reader uses to know which coefficients produced a 2026 number.
 */
import type { CollaboratorPerformance, IctdDossierRow } from "./read";
import type { PerformancePeriod } from "./period";

/**
 * The ratified coefficient set: D1 (DEP 1,30, four types) + D2 (10-dossier
 * reliability, coverage retired) + the §5.2 base units. Bump ONLY when a
 * coefficient changes, and never retroactively.
 */
export const PARAMETER_SET_VERSION = "2026.1";

/** The calculation engine's own identity, so a formula change is visible too. */
export const PERFORMANCE_ENGINE_VERSION = "slice1-1";

export type ReportStatus = "BROUILLON" | "PRET_POUR_REVUE" | "PUBLIE";

export const REPORT_STATUS_FR: Record<ReportStatus, string> = {
  BROUILLON: "Brouillon",
  PRET_POUR_REVUE: "Prêt pour revue",
  PUBLIE: "Publié",
};

export type ReportSnapshot = {
  /** Stamped so a reader knows which coefficients produced these numbers. */
  parameterSetVersion: string;
  engineVersion: string;
  period: PerformancePeriod;

  activity: {
    dossierCount: number;
    collaboratorCount: number;
    /** null when no dossier scored — never rendered as zero. */
    ictdTotal: number | null;
    ictdAverage: number | null;
    byDeclarationType: { type: string; dossiers: number; ictd: number | null }[];
    byClient: { client: string; dossiers: number; ictd: number | null }[];
  };

  collaborators: CollaboratorPerformance[];

  delays: {
    /** Dossiers whose délai could be computed at all. */
    measured: number;
    averageWorkingDays: number | null;
    slowest: { fileNumber: string; days: number }[];
  };

  attention: {
    nonCalculable: number;
    awaitingRevalidation: number;
    provisoire: number;
    calendarDays: number;
  };

  /** Named absences. A report that omits these invites the question. */
  methodology: {
    notes: string[];
    unavailableIndicators: { indicator: string; missing: readonly string[] }[];
  };
};

/** Build the snapshot from what the shared read service already computed. */
export function buildSnapshot(input: {
  period: PerformancePeriod;
  collaborators: CollaboratorPerformance[];
  dossiers: IctdDossierRow[];
  clientNames: Map<string, string>;
  calendarDays: number;
  unavailable: readonly { indicator: string; missing: readonly string[] }[];
}): ReportSnapshot {
  const { period, collaborators, dossiers, clientNames, calendarDays, unavailable } = input;

  const scored = dossiers.map((d) => d.ictd).filter((v): v is number => v !== null);
  const ictdTotal = scored.length > 0 ? round2(scored.reduce((a, b) => a + b, 0)) : null;

  const group = <K extends string>(key: (d: IctdDossierRow) => K | null) => {
    const m = new Map<K, { dossiers: number; sum: number; scored: number }>();
    for (const d of dossiers) {
      const k = key(d);
      if (k === null) continue;
      const cur = m.get(k) ?? { dossiers: 0, sum: 0, scored: 0 };
      cur.dossiers += 1;
      if (d.ictd !== null) {
        cur.sum += d.ictd;
        cur.scored += 1;
      }
      m.set(k, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ k, dossiers: v.dossiers, ictd: v.scored > 0 ? round2(v.sum) : null }))
      .sort((a, b) => b.dossiers - a.dossiers);
  };

  const measured = dossiers.filter((d) => d.delaiJoursOuvres !== null);
  const delaySum = measured.reduce((a, d) => a + (d.delaiJoursOuvres ?? 0), 0);

  const notes = [
    `Coefficients : jeu de paramètres ${PARAMETER_SET_VERSION} (non modifiable — l'historique publié ne peut pas être recalculé).`,
    "ICTD : sept termes, tous alimentés par la plateforme. Une facture commerciale non encore vérifiée ne compte pas.",
    "« Provisoire » signale moins de 10 dossiers sur la période : le volume ne permet pas encore d'interpréter le résultat.",
    "« Non calculable » signale un dossier sans type de déclaration ou sans régime DPI — la méthode laisse alors le dossier sans score plutôt que de lui en attribuer un de zéro.",
  ];
  if (calendarDays === 0) {
    notes.push(
      "⚠ Aucun jour férié ni fermeture n'est enregistré au calendrier de travail pour cette période : les délais et jours travaillés n'excluent que les samedis et dimanches.",
    );
  }

  return {
    parameterSetVersion: PARAMETER_SET_VERSION,
    engineVersion: PERFORMANCE_ENGINE_VERSION,
    period,
    activity: {
      dossierCount: dossiers.length,
      collaboratorCount: collaborators.length,
      ictdTotal,
      ictdAverage: ictdTotal !== null && scored.length > 0 ? round2(ictdTotal / scored.length) : null,
      byDeclarationType: group((d) => d.declarationType).map((r) => ({
        type: r.k,
        dossiers: r.dossiers,
        ictd: r.ictd,
      })),
      byClient: group((d) => (d.clientId ?? null))
        .slice(0, 10)
        .map((r) => ({ client: clientNames.get(r.k) ?? "—", dossiers: r.dossiers, ictd: r.ictd })),
    },
    collaborators,
    delays: {
      measured: measured.length,
      averageWorkingDays: measured.length > 0 ? Math.round((delaySum / measured.length) * 10) / 10 : null,
      slowest: [...measured]
        .sort((a, b) => (b.delaiJoursOuvres ?? 0) - (a.delaiJoursOuvres ?? 0))
        .slice(0, 5)
        .map((d) => ({ fileNumber: d.fileNumber, days: d.delaiJoursOuvres ?? 0 })),
    },
    attention: {
      nonCalculable: dossiers.filter((d) => d.ictd === null).length,
      awaitingRevalidation: dossiers.filter((d) => d.awaitingRevalidation).length,
      provisoire: collaborators.filter((c) => c.status === "PROVISOIRE").length,
      calendarDays,
    },
    methodology: {
      notes,
      unavailableIndicators: unavailable.map((u) => ({ indicator: u.indicator, missing: u.missing })),
    },
  };
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
