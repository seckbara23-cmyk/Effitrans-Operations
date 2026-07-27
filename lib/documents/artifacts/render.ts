/**
 * Internal-artifact renderer (Phase WES-4G.3/4G.4/4G.6). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * Renders `Demande de transport` and `Ordre de transport` from a normalized
 * source snapshot, reusing the repository's existing `PdfDoc` engine rather
 * than adding a second one.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM IS A CONTRACT, NOT A CONVENIENCE (WES-4G.6)
 *
 *     same snapshot + same RENDERER_VERSION  ⇒  byte-identical PDF ⇒ same hash
 *
 * That only holds if nothing non-deterministic reaches the page. So this
 * renderer takes NO clock and NO random source: there is no "generated at
 * 14:32" line, no document id in the footer, no creation date in the PDF
 * trailer. The generation timestamp and the actor are recorded in the DATABASE
 * row, where they belong and where they can be read without reopening a file.
 *
 * A test renders the same snapshot twice and asserts the bytes are identical;
 * without it, "reproducible" would be a claim nobody checks.
 */
import { PdfDoc } from "@/lib/reports/pdf";
import { SOURCE_FIELD_LABELS_FR, type ArtifactProvenance } from "./source";

/**
 * Bump when the visual output changes for the SAME snapshot. Two artifacts with
 * the same source hash but different renderer versions may legitimately differ
 * in bytes; two with the same both must not.
 */
export const RENDERER_VERSION = "wes4g-1";

const NAVY: [number, number, number] = [0.06, 0.15, 0.29];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const RULE: [number, number, number] = [0.85, 0.85, 0.85];

type Row = { label: string; value: string };

/** Field order per artifact. Fixed, because layout is part of determinism. */
const LAYOUT: Readonly<Record<string, readonly string[]>> = {
  DEMANDE_TRANSPORT: [
    "fileNumber", "fileType", "clientName",
    "transportMode", "origin", "destination",
    "cargoType", "containerRef",
    "pickupLocation", "pickupPlanned",
    "deliveryLocation", "deliveryPlanned",
    "requestedBy", "requestedAt",
  ],
  TRANSPORT_ORDER: [
    "fileNumber", "fileType", "clientName",
    "transportMode", "containerRef", "trailerOrContainer",
    "pickupLocation", "pickupPlanned",
    "deliveryLocation", "deliveryPlanned",
    "driverName", "vehiclePlate", "transportCompany",
  ],
};

const TITLES: Readonly<Record<string, string>> = {
  DEMANDE_TRANSPORT: "DEMANDE DE TRANSPORT",
  TRANSPORT_ORDER: "ORDRE DE TRANSPORT",
};

export function renderArtifact(input: {
  artifactCode: string;
  snapshot: Record<string, string>;
  provenance: ArtifactProvenance;
  /** Shown as the issuing organisation. Not a clock — safe for determinism. */
  organizationName: string;
  /** Version number of this artifact, e.g. 2 for a regeneration. */
  artifactVersion: number;
}): Uint8Array {
  const doc = new PdfDoc({ size: "A4", orientation: "portrait" });
  const M = 48;
  let y = doc.height - M;

  // ---- header -------------------------------------------------------------
  doc.text(M, y, input.organizationName, { size: 10, bold: true, color: NAVY });
  y -= 26;
  doc.text(M, y, TITLES[input.artifactCode] ?? input.artifactCode, {
    size: 18, bold: true, color: NAVY,
  });
  y -= 8;
  doc.line(M, y, doc.width - M, y, NAVY, 1);
  y -= 8;

  // Version is data, not a timestamp — it is stable for a given artifact row.
  doc.text(doc.width - M, y, `Version ${input.artifactVersion}`, {
    size: 8, color: GREY, align: "right",
  });
  y -= 22;

  // ---- body ---------------------------------------------------------------
  const rows: Row[] = (LAYOUT[input.artifactCode] ?? [])
    .filter((f) => input.snapshot[f] !== undefined)
    .map((f) => ({ label: SOURCE_FIELD_LABELS_FR[f] ?? f, value: input.snapshot[f] }));

  for (const row of rows) {
    doc.text(M, y, row.label.toUpperCase(), { size: 7, color: GREY });
    doc.text(M + 150, y, row.value, { size: 10, color: NAVY });
    y -= 10;
    doc.line(M, y, doc.width - M, y, RULE, 0.4);
    y -= 14;

    if (y < M + 80) {
      doc.addPage();
      y = doc.height - M;
    }
  }

  // ---- provenance ---------------------------------------------------------
  // WES-4G.4: when the driver is free text rather than an authenticated user,
  // the document says so. Silence here would let a legacy record read exactly
  // like a verified assignment.
  y -= 10;
  if (input.provenance === "LEGACY_TEXT_DRIVER") {
    doc.text(M, y,
      "Chauffeur saisi en texte libre — non rattaché à un compte authentifié.",
      { size: 8, color: [0.6, 0.35, 0.05] });
    y -= 14;
  } else if (input.provenance === "NO_DRIVER") {
    doc.text(M, y, "Aucun chauffeur affecté.", { size: 8, color: GREY });
    y -= 14;
  }

  // ---- footer -------------------------------------------------------------
  // Deliberately carries NO generation date: the row holds `generated_at`, and
  // printing it here would make every regeneration produce different bytes.
  doc.text(M, M - 12,
    "Document interne généré à partir des données structurées du dossier. " +
    "Toute correction se fait sur le dossier, puis par régénération.",
    { size: 7, color: GREY });

  return doc.toBytes();
}
