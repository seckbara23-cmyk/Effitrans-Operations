/**
 * The management briefing — derived from the snapshot, never computed anew.
 * ---------------------------------------------------------------------------
 * ONE derivation, used by the report page AND the PDF, so a briefing on screen
 * and a briefing on paper cannot differ. It is a pure function of a
 * `ReportSnapshot`: it reads fields that are already there and arranges them.
 * It computes no indicator, reaches no database, and — deliberately — draws no
 * conclusion. Every string below is a fact or a count; the interpretation is
 * Fary's, in her own section.
 *
 * WHY THE CAPACITY BASIS IS CALLED OUT. « 66,0 jours travaillés » is
 * arithmetically right and, with an empty calendar, means "66 weekdays, because
 * no holiday, no closure and no approved leave were on file" — which is a
 * materially different claim. Presenting the number without that qualifier is
 * how a correct figure becomes a misleading briefing, so the basis travels with
 * the number everywhere it appears.
 */
import type { ReportSnapshot } from "./report";

export type BriefingKpi = {
  label: string;
  value: string;
  /** Shown under the value when the figure needs a qualifier to be honest. */
  qualifier?: string;
};

export type AttentionSeverity = "INFO" | "ATTENTION" | "QUALITE";

export type AttentionFinding = {
  severity: AttentionSeverity;
  label: string;
  /** The deterministic count behind the finding; null when it is a state. */
  count: number | null;
  detail: string;
};

export type Briefing = {
  kpis: BriefingKpi[];
  findings: AttentionFinding[];
  /** How « jours travaillés » must be read for this period. */
  capacityBasis: {
    calendarPopulated: boolean;
    label: string;
    explanation: string;
  };
};

const fr = (v: number | null, d = 2) =>
  v === null ? "non calculable" : v.toFixed(d).replace(".", ",");

export function buildBriefing(snap: ReportSnapshot): Briefing {
  const calendarPopulated = snap.attention.calendarDays > 0;

  const capacityBasis = calendarPopulated
    ? {
        calendarPopulated: true,
        label: "Jours ouvrés hors fériés, fermetures et congés approuvés",
        explanation: `${snap.attention.calendarDays} jour(s) non travaillé(s) au calendrier de travail sur la période. Les congés approuvés sont déduits, une demi-journée comptant 0,5.`,
      }
    : {
        calendarPopulated: false,
        label: "Jours ouvrés — calendrier de travail non renseigné",
        explanation:
          "Aucun jour férié ni fermeture n'est enregistré pour cette période, et aucun congé approuvé n'a été trouvé : les jours travaillés correspondent donc aux jours de semaine, week-ends exclus. Ce n'est pas une erreur de calcul, mais la capacité affichée est plus élevée que la réalité tant que les RH n'ont pas renseigné le calendrier.",
      };

  // A collaborator is "reliable" only when classed; the count is what a reader
  // needs to weigh the rest of the page.
  const classes = snap.collaborators.filter((c) => c.status === "CLASSE").length;

  const kpis: BriefingKpi[] = [
    { label: "Période", value: snap.period.label },
    {
      label: "Dossiers analysés",
      value: String(snap.activity.dossierCount),
      qualifier:
        snap.attention.nonCalculable > 0
          ? `dont ${snap.attention.nonCalculable} non calculable(s)`
          : undefined,
    },
    {
      label: "Collaborateurs évalués",
      value: String(snap.activity.collaboratorCount),
      qualifier:
        snap.attention.provisoire > 0
          ? `${snap.attention.provisoire} en fiabilité provisoire`
          : classes > 0
            ? `${classes} classé(s)`
            : undefined,
    },
    {
      label: "ICTD total (UTD)",
      value: fr(snap.activity.ictdTotal),
      qualifier:
        snap.activity.ictdTotal === null
          ? "aucun dossier ne réunit les éléments requis"
          : `moyenne ${fr(snap.activity.ictdAverage)} par dossier`,
    },
    {
      label: "Délai moyen (jours ouvrés)",
      value: fr(snap.delays.averageWorkingDays, 1),
      qualifier:
        snap.delays.measured === 0
          ? "aucun délai mesurable sur la période"
          : `sur ${snap.delays.measured} dossier(s) mesurable(s)`,
    },
    {
      label: "Fiabilité",
      value:
        snap.activity.collaboratorCount === 0
          ? "aucune donnée"
          : snap.attention.provisoire === snap.activity.collaboratorCount
            ? "provisoire"
            : classes === snap.activity.collaboratorCount
              ? "classé"
              : "mixte",
      qualifier:
        snap.attention.provisoire > 0 ? "moins de 10 dossiers sur la période" : undefined,
    },
  ];

  // Deterministic findings only. Each is a count the platform holds; none is a
  // recommendation, and none is inferred.
  const findings: AttentionFinding[] = [];

  if (snap.attention.nonCalculable > 0) {
    findings.push({
      severity: "QUALITE",
      label: "Dossiers non calculables",
      count: snap.attention.nonCalculable,
      detail:
        "Le type de déclaration ou le régime DPI n'est pas saisi. La méthode laisse ces dossiers sans score plutôt que de leur en attribuer un de zéro : ils ne pèsent donc pas dans l'ICTD de la période.",
    });
  }

  if (snap.attention.awaitingRevalidation > 0) {
    findings.push({
      severity: "ATTENTION",
      label: "Dossiers à revalider",
      count: snap.attention.awaitingRevalidation,
      detail:
        "Une information douanière validée a été corrigée et attend une recertification par une autre personne que le correcteur.",
    });
  }

  if (snap.attention.provisoire > 0) {
    findings.push({
      severity: "INFO",
      label: "Fiabilité provisoire",
      count: snap.attention.provisoire,
      detail:
        "Moins de 10 dossiers sur la période : le volume ne permet pas encore d'interpréter le résultat, et ces collaborateurs n'entrent pas dans un classement.",
    });
  }

  if (!calendarPopulated) {
    findings.push({
      severity: "QUALITE",
      label: "Calendrier de travail non renseigné",
      count: null,
      detail: capacityBasis.explanation,
    });
  }

  if (snap.methodology.unavailableIndicators.length > 0) {
    findings.push({
      severity: "INFO",
      label: "Indicateurs non encore calculables",
      count: snap.methodology.unavailableIndicators.length,
      detail: snap.methodology.unavailableIndicators
        .map((u) => `${u.indicator} : ${u.missing.join(" ; ")}`)
        .join(" — "),
    });
  }

  return { kpis, findings, capacityBasis };
}
