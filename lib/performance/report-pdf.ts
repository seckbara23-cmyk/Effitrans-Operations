/**
 * The official management report, rendered from the FROZEN snapshot.
 * ---------------------------------------------------------------------------
 * This function takes a `ReportSnapshot` and nothing else. It cannot read the
 * database, so it cannot accidentally render live numbers into a document that
 * claims to be the record of a closed period — the guarantee is structural
 * rather than a rule somebody must remember.
 *
 * It reuses `lib/reports/pdf` (the hand-rolled engine behind official invoices
 * and quotations) rather than introducing a second document system.
 */
import { PdfDoc, textWidth } from "@/lib/reports/pdf";
import type { ReportSnapshot } from "./report";
import { buildBriefing } from "./briefing";

export const PERFORMANCE_REPORT_RENDERER_VERSION = "perf-1";

const NAVY: [number, number, number] = [0.06, 0.13, 0.25];
const SLATE: [number, number, number] = [0.42, 0.45, 0.5];
const RULE: [number, number, number] = [0.85, 0.87, 0.9];
const TEAL: [number, number, number] = [0.05, 0.45, 0.42];
const AMBER: [number, number, number] = [0.72, 0.45, 0.05];

const M = 56; // page margin
const W = 595; // A4 width in points
const RIGHT = W - M;

const num = (v: number | null, digits = 2) =>
  v === null ? "non calculable" : v.toFixed(digits).replace(".", ",");

/** Wrap to a width, in the engine's own metrics. */
function wrap(s: string, size: number, maxWidth: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (textWidth(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type ReportProvenance = {
  preparedBy: string | null;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  parameterSetVersion: string;
  engineVersion: string;
};

export function renderPerformanceReport(input: {
  title: string;
  snapshot: ReportSnapshot;
  provenance: ReportProvenance;
  executiveSummary?: string | null;
  managementCommentary?: string | null;
}): Uint8Array {
  const { title, snapshot: snap, provenance } = input;
  // The SAME derivation the screen uses — a briefing on paper and a briefing on
  // screen cannot say different things.
  const briefing = buildBriefing(snap);
  const doc = new PdfDoc({ size: "A4" });
  let y = M;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > 780) {
      doc.addPage();
      y = M;
    }
  };

  const heading = (text: string) => {
    newPageIfNeeded(40);
    y += 14;
    doc.text(M, y, text, { size: 11, bold: true, color: NAVY });
    y += 6;
    doc.line(M, y + 4, RIGHT, y + 4, RULE);
    y += 14;
  };

  const row = (label: string, value: string, emphasis = false) => {
    newPageIfNeeded(18);
    doc.text(M, y, label, { size: 9, color: SLATE });
    doc.text(RIGHT, y, value, {
      size: 9,
      bold: emphasis,
      color: emphasis ? NAVY : SLATE,
      align: "right",
    });
    y += 14;
  };

  const paragraph = (text: string, color = SLATE, size = 9) => {
    for (const line of wrap(text, size, RIGHT - M)) {
      newPageIfNeeded(16);
      doc.text(M, y, line, { size, color });
      y += size + 4;
    }
    y += 4;
  };

  // ------------------------------------------------------------- header ----
  doc.fillRect(0, 0, W, 4, TEAL);
  y = M;
  doc.text(M, y, "EFFITRANS", { size: 10, bold: true, color: TEAL });
  doc.text(RIGHT, y, "Rapport de performance", { size: 8, color: SLATE, align: "right" });
  y += 18;
  doc.text(M, y, title, { size: 17, bold: true, color: NAVY });
  y += 22;
  doc.text(M, y, `Période : ${snap.period.label}  (${snap.period.startISO} → ${snap.period.endISO})`, {
    size: 10,
    color: SLATE,
  });
  y += 16;

  // Provenance, from the frozen record. Never recomputed, never a browser clock.
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  doc.text(M, y, `Préparé par ${provenance.preparedBy ?? "—"} le ${day(provenance.createdAt)}`, {
    size: 8,
    color: SLATE,
  });
  y += 11;
  if (provenance.publishedAt) {
    doc.text(M, y, `Publié par ${provenance.publishedBy ?? "—"} le ${day(provenance.publishedAt)}`, {
      size: 8,
      color: SLATE,
    });
    y += 11;
  }
  doc.text(
    M,
    y,
    `Jeu de paramètres ${provenance.parameterSetVersion} · moteur ${provenance.engineVersion} · rendu ${PERFORMANCE_REPORT_RENDERER_VERSION}`,
    { size: 8, color: SLATE },
  );
  y += 12;
  doc.line(M, y, RIGHT, y, RULE);
  y += 6;

  // ------------------------------------------------ synthèse exécutive ----
  heading("Synthèse exécutive");
  for (const k of briefing.kpis) {
    row(k.label, k.qualifier ? `${k.value}  (${k.qualifier})` : k.value, true);
  }

  y += 4;
  paragraph(`Base de capacité : ${briefing.capacityBasis.label}.`, NAVY, 8);
  paragraph(briefing.capacityBasis.explanation, SLATE, 8);

  if (input.executiveSummary) {
    y += 2;
    doc.text(M, y, "Lecture de la direction", { size: 9, bold: true, color: NAVY });
    y += 13;
    paragraph(input.executiveSummary, SLATE, 9);
  }

  // ---------------------------------------- points d'attention direction ----
  heading("Points d'attention de la Direction");
  if (briefing.findings.length === 0) {
    paragraph("Aucun point d'attention sur cette période.");
  } else {
    for (const f of briefing.findings) {
      newPageIfNeeded(34);
      const head = f.count !== null ? `${f.count} · ${f.label}` : f.label;
      doc.text(M, y, head, { size: 9, bold: true, color: f.severity === "INFO" ? NAVY : AMBER });
      y += 12;
      paragraph(f.detail, SLATE, 8);
    }
  }

  // ------------------------------------------ commentaire de la direction ----
  if (input.managementCommentary) {
    heading("Commentaire de la Responsable Performance");
    paragraph(input.managementCommentary, SLATE, 9);
  }

  // --------------------------------------------------------- activité ----
  heading("Détail — activité globale");
  row("Dossiers traités", String(snap.activity.dossierCount), true);
  row("ICTD total (UTD)", num(snap.activity.ictdTotal), true);
  row("ICTD moyen par dossier", num(snap.activity.ictdAverage));

  if (snap.activity.byDeclarationType.length > 0) {
    heading("Typologie des déclarations");
    for (const t of snap.activity.byDeclarationType) {
      row(t.type, `${t.dossiers} dossier(s) · ${num(t.ictd)} UTD`);
    }
  }

  if (snap.activity.byClient.length > 0) {
    heading("Clients — charge générée");
    for (const c of snap.activity.byClient) {
      row(c.client, `${c.dossiers} dossier(s) · ${num(c.ictd)} UTD`);
    }
  }

  // ---------------------------------------------------- collaborateurs ----
  heading("Performance des collaborateurs et capacité");
  paragraph(`${briefing.capacityBasis.label}.`, SLATE, 8);
  if (snap.collaborators.length === 0) {
    paragraph("Aucun collaborateur évalué sur la période.");
  } else {
    newPageIfNeeded(20);
    doc.text(M, y, "Collaborateur", { size: 8, bold: true, color: SLATE });
    doc.text(M + 210, y, "Dossiers", { size: 8, bold: true, color: SLATE });
    doc.text(M + 280, y, "J. trav.", { size: 8, bold: true, color: SLATE });
    doc.text(M + 350, y, "ICTD", { size: 8, bold: true, color: SLATE });
    doc.text(RIGHT, y, "Fiabilité", { size: 8, bold: true, color: SLATE, align: "right" });
    y += 12;
    for (const c of snap.collaborators) {
      newPageIfNeeded(16);
      doc.text(M, y, c.name.slice(0, 34), { size: 9, color: NAVY });
      doc.text(M + 210, y, String(c.dossierCount), { size: 9, color: SLATE });
      doc.text(M + 280, y, c.workedDays.toFixed(1).replace(".", ","), { size: 9, color: SLATE });
      doc.text(M + 350, y, num(c.ictdTotal), { size: 9, color: SLATE });
      doc.text(RIGHT, y, statusFr(c.status), {
        size: 9,
        color: c.status === "CLASSE" ? TEAL : AMBER,
        align: "right",
      });
      y += 13;
    }
  }

  // ------------------------------------------------------------ délais ----
  heading("Délais de traitement");
  row("Dossiers avec délai mesurable", String(snap.delays.measured));
  row("Délai moyen (jours ouvrés)", num(snap.delays.averageWorkingDays, 1));
  for (const s of snap.delays.slowest) {
    row(s.fileNumber, `${s.days} jour(s) ouvré(s)`);
  }

  // ------------------------------------------------------ méthodologie ----
  heading("Méthodologie et fiabilité");
  for (const n of snap.methodology.notes) paragraph(n);

  if (snap.methodology.unavailableIndicators.length > 0) {
    y += 4;
    doc.text(M, y, "Indicateurs non encore calculables", { size: 9, bold: true, color: NAVY });
    y += 14;
    for (const u of snap.methodology.unavailableIndicators) {
      paragraph(`${u.indicator} — sources manquantes : ${u.missing.join(" ; ")}.`);
    }
  }

  y += 6;
  paragraph(
    `Document généré à partir de l'instantané figé du rapport (moteur ${snap.engineVersion}). Les valeurs ci-dessus sont celles publiées et ne changent pas.`,
    SLATE,
    8,
  );

  return doc.toBytes();
}

function statusFr(s: string): string {
  switch (s) {
    case "CLASSE":
      return "Classé";
    case "PROVISOIRE":
      return "Provisoire";
    case "REVUE_MANAGERIALE":
      return "Revue managériale";
    default:
      return "Aucune donnée";
  }
}
