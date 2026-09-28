/**
 * Generated-artifact source contract (Phase WES-4G.2/4G.3/4G.4). PURE.
 * ---------------------------------------------------------------------------
 * Defines, for each generatable artifact, exactly which structured fields are
 * MANDATORY and which are optional — and refuses to build a snapshot when a
 * mandatory one is absent.
 *
 * That refusal is the point. WES-4G.3 says "reject generation when mandatory
 * source fields are absent" and 4G.4 says "do not invent a driver or vehicle".
 * A rendered PDF with an empty driver line does not read as incomplete; it
 * reads as an order with no driver, which is a claim the data does not support.
 *
 * The snapshot is NORMALIZED (sorted keys, trimmed strings, nulls dropped) so
 * the same source produces the same hash on any machine, in any order the
 * caller happened to assemble it.
 */

export type ArtifactSourceInput = {
  fileNumber: string | null;
  fileType: string | null;
  clientName: string | null;
  transportMode: string | null;
  origin: string | null;
  destination: string | null;
  cargoType: string | null;
  containerRef: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupPlanned: string | null;
  deliveryPlanned: string | null;
  driverName: string | null;
  /** Set when an AUTHENTICATED driver user is linked, not free text. */
  driverUserId: string | null;
  /**
   * The vehicle as the platform names it (TRN-VEHICLE-01): the bound fleet
   * vehicle's registration first, the free-text plate of an external vehicle
   * otherwise. The snapshot key keeps its historical name.
   */
  vehiclePlate: string | null;
  /**
   * RQ-18 — which BRANCH executes this transport. Set when a subcontractor is
   * bound. Provenance, never content: it is excluded from the snapshot exactly
   * like `driverUserId`, because a document body must not carry a UUID.
   */
  providerId: string | null;
  trailerOrContainer: string | null;
  transportCompany: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
};

/** Mandatory fields per artifact. Everything else is optional and may be null. */
const MANDATORY: Readonly<Record<string, readonly (keyof ArtifactSourceInput)[]>> = {
  DEMANDE_TRANSPORT: [
    "fileNumber",
    "clientName",
    "pickupLocation",
    "deliveryLocation",
    "pickupPlanned",
  ],
  // INTERNAL FLEET. An order Effitrans executes itself without a driver and a
  // vehicle is not an order: both are ours to know at the moment we issue it.
  TRANSPORT_ORDER: [
    "fileNumber",
    "clientName",
    "pickupLocation",
    "deliveryLocation",
    "pickupPlanned",
    "driverName",
    "vehiclePlate",
  ],
};

/**
 * EXTERNAL / subcontracted transport (RQ-18, ratified 2026-08-20).
 *
 * This list was written under WES-4G on 2026-07-27, three weeks before TMS-6
 * gave transports a second execution branch, so it required driver and plate of
 * everyone — including carriers who had not yet named either. Effitrans ratified
 * the operational answer: an order confided to a subcontractor may be ISSUED
 * naming the agreed carrier, with the driver and the immatriculation recorded
 * later when the carrier supplies them.
 *
 * So the execution party is still mandatory — it just IS the carrier here.
 * `transportCompany` is the assignment-time snapshot (UAT-17), not the live
 * registry name, so the order keeps naming the carrier it was actually given to.
 *
 * The internal-fleet rule above is deliberately untouched.
 */
const TRANSPORT_ORDER_EXTERNAL: readonly (keyof ArtifactSourceInput)[] = [
  "fileNumber",
  "clientName",
  "pickupLocation",
  "deliveryLocation",
  "pickupPlanned",
  "transportCompany",
];

/**
 * The mandatory set for this artifact AND this transport's execution branch.
 * Branch is decided by `providerId` — the same signal the execution-source
 * exclusivity CHECK uses, so readiness can never disagree with the database
 * about which branch a transport is on.
 */
export function mandatoryFieldsFor(
  artifactCode: string,
  input: Pick<ArtifactSourceInput, "providerId">,
): readonly (keyof ArtifactSourceInput)[] | undefined {
  if (artifactCode === "TRANSPORT_ORDER" && input.providerId) return TRANSPORT_ORDER_EXTERNAL;
  return MANDATORY[artifactCode];
}

/**
 * Source fields an operator fills on the TRANSPORT record (FIN-TRN-DOC-01).
 *
 * The mandatory sets above are the contract; this says WHERE a missing one is
 * corrected. `fileNumber` and `clientName` come from the dossier itself and are
 * never typed into the transport panel, so pointing an operator there for them
 * would send them to a form that cannot fix it.
 *
 * `vehiclePlate` is listed under its snapshot name; on the panel it is the fleet
 * vehicle or the free-text plate, resolved exactly as `readArtifactSource` does.
 */
const TRANSPORT_OWNED_LIST = [
  "pickupLocation",
  "deliveryLocation",
  "pickupPlanned",
  "deliveryPlanned",
  "driverName",
  "vehiclePlate",
  "transportCompany",
  "trailerOrContainer",
] as const;

/** One of the fields above, as a literal type. */
export type TransportOwnedSourceField = (typeof TRANSPORT_OWNED_LIST)[number];

// The annotation is the check: every literal above must be a real source field,
// so renaming one in ArtifactSourceInput breaks the build here rather than
// silently pointing an operator at a field the panel no longer has.
export const TRANSPORT_OWNED_SOURCE_FIELDS: readonly (keyof ArtifactSourceInput)[] =
  TRANSPORT_OWNED_LIST;

const TRANSPORT_OWNED = new Set<string>(TRANSPORT_OWNED_LIST);

/** Is this missing field corrected on the dossier's transport panel? */
export function isTransportOwnedSourceField(field: string): field is TransportOwnedSourceField {
  return TRANSPORT_OWNED.has(field);
}

/**
 * Which of these artifacts require this source field, on THIS transport's
 * execution branch.
 *
 * Derived from `mandatoryFieldsFor` — the same rule the generator refuses on —
 * so a surface that says « requis pour l'Ordre de transport » cannot disagree
 * with the refusal an operator gets when they press Générer. RQ-18 is honoured
 * for free: a subcontracted transport reports the carrier, not the driver.
 */
export function artifactsRequiringSourceField(
  field: keyof ArtifactSourceInput,
  artifactCodes: readonly string[],
  input: Pick<ArtifactSourceInput, "providerId">,
): string[] {
  return artifactCodes.filter((code) =>
    (mandatoryFieldsFor(code, input) ?? []).includes(field),
  );
}

/** Human labels for the missing-field report the UI shows. */
export const SOURCE_FIELD_LABELS_FR: Readonly<Record<string, string>> = {
  fileNumber: "Numéro de dossier",
  fileType: "Type de dossier",
  clientName: "Client",
  transportMode: "Mode de transport",
  origin: "Origine",
  destination: "Destination",
  cargoType: "Nature de la marchandise",
  containerRef: "Référence conteneur",
  pickupLocation: "Lieu d'enlèvement",
  deliveryLocation: "Lieu de livraison",
  pickupPlanned: "Enlèvement prévu",
  deliveryPlanned: "Livraison prévue",
  driverName: "Chauffeur",
  vehiclePlate: "Véhicule",
  trailerOrContainer: "Remorque / conteneur",
  transportCompany: "Transporteur",
  requestedBy: "Demandeur",
  requestedAt: "Date de la demande",
};

export type SourceResolution =
  | { ok: true; snapshot: Record<string, string>; provenance: ArtifactProvenance }
  | { ok: false; missing: { field: string; labelFr: string }[] };

/**
 * How trustworthy the driver identity on this artifact is.
 *
 * WES-4G.4 offers two options for a legacy free-text chauffeur; this takes the
 * first — generate, but LABEL it. Refusing would block real operational work on
 * dossiers whose driver was recorded before authenticated assignment existed,
 * and the artifact stays honest because it says which kind of driver it names.
 */
export type ArtifactProvenance = "AUTHENTICATED_DRIVER" | "LEGACY_TEXT_DRIVER" | "NO_DRIVER";

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Build the snapshot, or report precisely what is missing.
 *
 * Note what the snapshot does NOT carry: operational notes, review commentary,
 * driver phone numbers, or anything not needed to reproduce and explain the
 * artifact. WES-4G.2 forbids unrestricted notes, and a snapshot is stored
 * forever beside an immutable document.
 */
export function resolveArtifactSource(
  artifactCode: string,
  input: ArtifactSourceInput,
): SourceResolution {
  const mandatory = mandatoryFieldsFor(artifactCode, input);
  if (!mandatory) return { ok: false, missing: [{ field: "artifact", labelFr: "Type non générable" }] };

  const missing = mandatory
    .filter((f) => clean(input[f] as string | null) === null)
    .map((f) => ({ field: String(f), labelFr: SOURCE_FIELD_LABELS_FR[String(f)] ?? String(f) }));
  if (missing.length > 0) return { ok: false, missing };

  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    // driverUserId is provenance, not content: it identifies a person and does
    // not belong in a document body or its reproducible snapshot. providerId is
    // the same kind of fact — it selects the BRANCH; the carrier is named by
    // transportCompany, which is the snapshot the document should carry.
    if (key === "driverUserId" || key === "providerId") continue;
    const v = clean(value as string | null);
    if (v !== null) snapshot[key] = v;
  }

  const provenance: ArtifactProvenance = input.driverUserId
    ? "AUTHENTICATED_DRIVER"
    : clean(input.driverName)
      ? "LEGACY_TEXT_DRIVER"
      : "NO_DRIVER";

  return { ok: true, snapshot, provenance };
}

/**
 * Deterministic serialization for hashing. Keys sorted, so two callers that
 * assembled the same facts in different orders hash identically — which is what
 * makes "same source ⇒ same artifact" checkable rather than aspirational.
 */
export function canonicalizeSnapshot(snapshot: Record<string, string>): string {
  const keys = Object.keys(snapshot).sort();
  return JSON.stringify(keys.map((k) => [k, snapshot[k]]));
}
