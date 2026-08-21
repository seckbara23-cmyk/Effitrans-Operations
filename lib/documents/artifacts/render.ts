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
export const RENDERER_VERSION = "wes4g-4";

/**
 * Artifacts that print an issue date, and nothing else does.
 *
 * RQ / Alternative B (ratified 2026-08-21) — an ORDRE DE TRANSPORT is handed to
 * a carrier and read later by whoever asks when it was issued, so it carries
 * « Émis le : … ». The DEMANDE already prints « Date de la demande », a
 * different and more useful business fact, so it is deliberately NOT included:
 * the decision was to add this where the business document needs it, not to
 * inject a date everywhere.
 */
const ARTIFACTS_WITH_ISSUE_DATE = new Set(["TRANSPORT_ORDER"]);

/**
 * RQ-18b (ratified 2026-08-21) — PER-ARTIFACT label overrides.
 *
 * `transportMode` is the mode of the EXPÉDITION — how the principal shipment
 * moves internationally — and every consumer treats it that way: air tracking
 * gates on AIR, customs drops the airway bill or the bill of lading from it.
 *
 * On an ORDRE DE TRANSPORT it was printed under a bare « Mode de transport »,
 * on a document whose whole purpose is to instruct a ROAD movement — so a
 * reader could not tell whether « SEA » described the voyage the goods arrived
 * on or the movement being ordered.
 *
 * The VALUE is right and stays: a carrier benefits from knowing the goods came
 * off a vessel and may be containerised. Only the label stops overstating what
 * it describes. Scoped to this artifact deliberately: on the DEMANDE DE
 * TRANSPORT, a dossier-level document, « Mode de transport » is unambiguous.
 *
 * What this does NOT do, per the ratified decision: it does not touch
 * `shipment.transport_mode`, its SEA/AIR/ROAD/MULTIMODAL vocabulary, or
 * introduce any execution-mode column. The Effitrans road execution remains the
 * « segment routier » modelled by `transport_record`, which carries no mode
 * because it only ever models one.
 */
const ARTIFACT_LABEL_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  TRANSPORT_ORDER: { transportMode: "Mode de l'expédition" },
};

/**
 * DEFECT-UAT18b — `PdfDoc` has a TOP-LEFT origin (`text` converts via
 * `this.height - y`). The original renderer started at `doc.height - M` and
 * DECREMENTED, i.e. it was written for a bottom-left origin, so the header
 * landed near the foot of the page and content marched upward — the large
 * unexplained blank area the operator reported. Everything below measures y
 * from the TOP and grows downward.
 */

/**
 * ISO → French. « 2026-08-20 » ⇒ « 20/08/2026 », and with a time
 * « 20/08/2026 à 10:00 ». Parsed by pattern, never by `new Date`: a Date would
 * make the output depend on the machine's timezone, and determinism is a
 * contract here. Anything unrecognised passes through untouched rather than
 * being mangled into a wrong date.
 */
export function frDateTime(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return value;
  const [, yyyy, mm, dd, hh, mi] = m;
  const date = `${dd}/${mm}/${yyyy}`;
  return hh && mi ? `${date} à ${hh}:${mi}` : date;
}

/**
 * DATE ONLY — « 21/08/2026 », never a time. The issue date is a calendar fact
 * about the document; printing an hour would invite the reader to treat it as a
 * precise instant, and would differ across timezones for the same artifact.
 * Same pattern parse as `frDateTime`, so it is equally timezone-free.
 */
export function frDate(value: string): string {
  return frDateTime(value).split(" à ")[0];
}

/** Fields rendered as dates rather than raw strings. */
const DATE_FIELDS = new Set(["pickupPlanned", "deliveryPlanned", "requestedAt"]);

const display = (field: string, value: string): string =>
  DATE_FIELDS.has(field) ? frDateTime(value) : value;

/**
 * ORDRE DE TRANSPORT — an operational instruction handed to a carrier, so it is
 * composed as SECTIONS rather than one flat list of labels.
 *
 * A section whose fields are all absent is skipped entirely. That is how
 * Branch B omits driver and vehicle: not a blank row, not a placeholder — the
 * « EXÉCUTION » block simply does not exist on an order whose carrier has not
 * yet named a driver.
 */
const ORDER_SECTIONS: readonly { title: string; fields: readonly string[] }[] = [
  { title: "Client / Dossier", fields: ["clientName", "fileNumber", "fileType", "transportMode"] },
  { title: "Transporteur", fields: ["transportCompany"] },
  { title: "Enlèvement", fields: ["pickupLocation", "pickupPlanned"] },
  { title: "Livraison", fields: ["deliveryLocation", "deliveryPlanned"] },
  { title: "Marchandise et références", fields: ["cargoType", "containerRef", "trailerOrContainer", "origin", "destination"] },
  { title: "Exécution", fields: ["driverName", "vehiclePlate"] },
];

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
  /**
   * The artifact's OWN generation timestamp, minted once by the caller and
   * persisted verbatim as `document.generated_at`.
   *
   * It is an INPUT, never a clock read here: that is what lets an archived
   * version be re-rendered byte-for-byte later. The reproduction contract is
   * therefore (source_snapshot, renderer_version, artifactVersion, generatedAt).
   * Omitted ⇒ no issue date is printed, which is what every pre-existing
   * artifact has.
   */
  generatedAt?: string | null;
}): Uint8Array {
  const doc = new PdfDoc({ size: "A4", orientation: "portrait" });
  const M = 48;
  const isOrder = input.artifactCode === "TRANSPORT_ORDER";
  // TOP-LEFT origin: y starts at the top margin and GROWS downward.
  let y = M;

  // ---- header -------------------------------------------------------------
  doc.text(M, y, input.organizationName, { size: 10, bold: true, color: NAVY });
  y += 24;
  doc.text(M, y, TITLES[input.artifactCode] ?? input.artifactCode, {
    size: 18, bold: true, color: NAVY,
  });
  // Identity on the same line as the title, right-aligned: the dossier this
  // order belongs to, and which version of it this sheet is.
  const fileNumber = input.snapshot.fileNumber;
  if (fileNumber) {
    doc.text(doc.width - M, y - 10, `Dossier ${fileNumber}`, {
      size: 9, bold: true, color: NAVY, align: "right",
    });
  }
  // Version is data, not a timestamp — stable for a given artifact row.
  doc.text(doc.width - M, y + 2, `Version ${input.artifactVersion}`, {
    size: 8, color: GREY, align: "right",
  });
  // RQ / Alternative B — the issue date. Printed from the SUPPLIED timestamp,
  // never from a clock read here: the same inputs must always produce the same
  // bytes, and this value is persisted verbatim as `document.generated_at`, so
  // the printed document and the row can never disagree.
  if (ARTIFACTS_WITH_ISSUE_DATE.has(input.artifactCode) && input.generatedAt) {
    doc.text(doc.width - M, y + 14, `Émis le : ${frDate(input.generatedAt)}`, {
      size: 8, color: GREY, align: "right",
    });
    y += 12;
  }
  y += 8;
  doc.line(M, y, doc.width - M, y, NAVY, 1);
  y += 20;

  const overrides = ARTIFACT_LABEL_OVERRIDES[input.artifactCode] ?? {};
  const rowsFor = (fields: readonly string[]): Row[] =>
    fields
      .filter((f) => input.snapshot[f] !== undefined)
      .map((f) => ({
        label: overrides[f] ?? SOURCE_FIELD_LABELS_FR[f] ?? f,
        value: display(f, input.snapshot[f]),
      }));

  const drawRows = (rows: Row[]) => {
    for (const row of rows) {
      doc.text(M, y, row.label.toUpperCase(), { size: 7, color: GREY });
      doc.text(M + 150, y, row.value, { size: 10, color: NAVY });
      y += 12;
      doc.line(M, y, doc.width - M, y, RULE, 0.4);
      y += 12;
      if (y > doc.height - M - 60) {
        doc.addPage();
        y = M;
      }
    }
  };

  if (isOrder) {
    // ---- sectioned composition (DEFECT-UAT18b) ----------------------------
    for (const s of ORDER_SECTIONS) {
      const rows = rowsFor(s.fields);
      // An entirely absent section is SKIPPED — this is how Branch B omits
      // « Exécution » when the carrier has not yet named a driver or a vehicle.
      if (rows.length === 0) continue;
      doc.text(M, y, s.title.toUpperCase(), { size: 8, bold: true, color: NAVY });
      y += 6;
      doc.line(M, y, doc.width - M, y, NAVY, 0.6);
      y += 14;
      drawRows(rows);
      y += 10;
    }
  } else {
    drawRows(rowsFor(LAYOUT[input.artifactCode] ?? []));
  }

  // ---- provenance ---------------------------------------------------------
  // WES-4G.4: when the driver is free text rather than an authenticated user,
  // the document says so. Silence here would let a legacy record read exactly
  // like a verified assignment.
  y += 6;
  if (input.provenance === "LEGACY_TEXT_DRIVER") {
    doc.text(M, y,
      "Chauffeur saisi en texte libre — non rattaché à un compte authentifié.",
      { size: 8, color: [0.6, 0.35, 0.05] });
  } else if (input.provenance === "NO_DRIVER" && !isOrder) {
    // DEFECT-UAT18a — NOT on an ORDRE DE TRANSPORT. The internal-fleet branch
    // cannot reach NO_DRIVER at all, because readiness makes `driverName`
    // mandatory there; so on an order this line can only ever describe a
    // subcontracted transport, where « Aucun chauffeur affecté » would ASSERT
    // an absence that is merely not-yet-known. RQ-18 says omit, so we omit.
    doc.text(M, y, "Aucun chauffeur affecté.", { size: 8, color: GREY });
  }

  // ---- footer -------------------------------------------------------------
  // Discreet, at the foot of the page, and deliberately carrying NO generation
  // date for the determinism reason above.
  doc.text(M, doc.height - M + 12,
    "Document interne généré à partir des données structurées du dossier. " +
    "Toute correction se fait sur le dossier, puis par régénération.",
    { size: 7, color: GREY });

  return doc.toBytes();
}
