/**
 * UT-4 — presentation vocabulary for the Unified Operational Timeline. PURE.
 * ---------------------------------------------------------------------------
 * Labels, filter definitions, icon keys and screen-reader phrasing. No I/O, no
 * React: the rules about what a timeline entry MEANS are testable without
 * rendering anything, and the UI cannot quietly disagree with them.
 *
 * It decides nothing about history. Ordering, grouping and provability all
 * arrive already settled from `merged.ts`; this module only names them.
 */
import type { Plane, UnifiedEntry } from "./merged";
import type { EventNature, EventOrigin } from "./contract";

/* ========================================================================== */
/* Filters                                                                    */
/* ========================================================================== */

export const TIMELINE_FILTERS = [
  "all", "commercial", "communication", "operations", "document", "finance", "tracking",
] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const FILTER_LABEL_FR: Record<TimelineFilter, string> = {
  all: "Tout",
  commercial: "Commercial",
  communication: "Communications",
  operations: "Opérations",
  document: "Documents",
  finance: "Finance",
  tracking: "Suivi",
};

/**
 * Which Decision Plane domains each filter admits. `tracking` admits none: it is
 * the Observation Plane, selected by plane rather than by domain, because an
 * observation has no domain at all.
 */
const FILTER_DOMAINS: Record<TimelineFilter, readonly string[]> = {
  all: [],
  commercial: ["commercial"],
  communication: ["communication"],
  // "Operations" is the dossier's own working life: its status, its tasks, its
  // process and the handoffs between departments. Four registry domains, one
  // operational idea — a user does not think in domain names.
  operations: ["dossier", "task", "process", "handoff"],
  document: ["document"],
  finance: ["finance"],
  tracking: [],
};

export function matchesFilter(entry: UnifiedEntry, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tracking") return entry.plane === "observation";
  if (entry.plane === "observation") return false;
  return FILTER_DOMAINS[filter].includes(entry.domain ?? "");
}

/** Secondary filters. Optional, and deliberately orthogonal to the primary set. */
export const PLANE_FILTERS = ["decision", "observation"] as const;
export const ORIGIN_FILTERS = ["human", "system", "external"] as const;

export function matchesPlane(entry: UnifiedEntry, plane: Plane | null): boolean {
  return plane === null || entry.plane === plane;
}
export function matchesOrigin(entry: UnifiedEntry, origin: EventOrigin | null): boolean {
  return origin === null || entry.origin === origin;
}

/* ========================================================================== */
/* Vocabulary                                                                 */
/* ========================================================================== */

export const PLANE_LABEL_FR: Record<Plane, string> = {
  decision: "Décision",
  observation: "Observation",
};

export const NATURE_LABEL_FR: Record<EventNature, string> = {
  decision: "Décision confirmée",
  observation: "Observation",
  computed: "Valeur calculée",
};

export const ORIGIN_LABEL_FR: Record<EventOrigin, string> = {
  human: "Action humaine",
  system: "Automatique",
  external: "Source externe",
};

export const CONFIDENCE_LABEL_FR: Record<string, string> = {
  CONFIRMED: "Confirmée",
  INFERRED: "Déduite",
  MANUAL: "Saisie manuelle",
  ESTIMATED: "Estimée",
};

export const FRESHNESS_LABEL_FR: Record<string, string> = {
  LIVE: "En direct",
  RECENT: "Récente",
  STALE: "Ancienne",
  VERY_STALE: "Très ancienne",
  UNKNOWN: "Fraîcheur inconnue",
};

/** Icon keys from `lib/icons` — never an emoji. */
export function iconKeyFor(entry: UnifiedEntry): string {
  if (entry.plane === "observation") return "route";
  switch (entry.domain) {
    case "commercial": return "quote";
    case "communication": return "message";
    case "document": return "document";
    case "finance": return "finance";
    case "customs": return "stamp";
    case "transport": return "truck";
    case "task": return "task";
    default: return "history";
  }
}

/* ========================================================================== */
/* Screen-reader phrasing                                                     */
/* ========================================================================== */

/**
 * The full meaning of an entry in words, for assistive technology.
 *
 * Everything the visual treatment conveys through weight, tone or a badge is
 * repeated here as text — the accessibility requirement is not a caption, it is
 * that **no meaning is carried by colour or emphasis alone**.
 */
export function describeEntry(entry: UnifiedEntry): string {
  const parts: string[] = [
    PLANE_LABEL_FR[entry.plane],
    entry.label,
    NATURE_LABEL_FR[entry.nature],
    ORIGIN_LABEL_FR[entry.origin],
  ];
  if (entry.actorName) parts.push(`par ${entry.actorName}`);
  if (entry.observationSource) parts.push(`source ${entry.observationSource}`);
  if (entry.confidence) parts.push(`fiabilité ${CONFIDENCE_LABEL_FR[entry.confidence] ?? entry.confidence}`);
  if (entry.freshness) parts.push(FRESHNESS_LABEL_FR[entry.freshness] ?? entry.freshness);
  if (entry.locationName) parts.push(`lieu ${entry.locationName}`);
  if (!entry.chronologyProvable) {
    parts.push("ordre non prouvable par rapport aux évènements du même instant");
  }
  if (entry.clientSafe) parts.push("visible par le client");
  return parts.join(" · ");
}

/** The sentence shown above a group whose internal order was never recorded. */
export const UNPROVABLE_GROUP_NOTICE =
  "Ces évènements portent le même instant. Leur ordre entre eux n'a jamais été enregistré : ils sont présentés ensemble, sans séquence.";

/* ========================================================================== */
/* Authorized links                                                           */
/* ========================================================================== */

export type TimelineLink = { href: string; label: string } | null;

/**
 * Where an entry leads, when the reader is allowed to follow.
 *
 * Authorization is the CALLER'S: this function is handed the permissions the
 * page already resolved and returns nothing when they are missing, so an
 * unauthorized link is absent rather than rendered-and-refused. It never
 * exposes a storage path, a message body or an amount — it points at the
 * workspace that owns the thing and lets that workspace apply its own rules.
 */
export function linkFor(entry: UnifiedEntry, permissions: readonly string[]): TimelineLink {
  const has = (p: string) => permissions.includes(p);

  if (entry.plane === "observation") {
    // Reuse the EXISTING tracking surface. No second map, and no coordinates.
    return has("transport:read") ? { href: "/transport", label: "Ouvrir le suivi" } : null;
  }

  switch (entry.domain) {
    case "document":
      return has("document:read") && entry.dossierId
        ? { href: `/files/${entry.dossierId}/documents`, label: "Ouvrir les documents" }
        : null;
    case "communication":
      return has("communication:read")
        ? { href: "/mail", label: "Ouvrir les communications" }
        : null;
    case "commercial": {
      const q = entry.summary.quotation_id;
      if (!has("quotation:create") && !has("quotation:validate")) return null;
      return typeof q === "string"
        ? { href: `/commercial/quotations/${q}`, label: "Ouvrir la cotation" }
        : { href: "/commercial", label: "Ouvrir le commercial" };
    }
    case "finance":
      // Milestones only. The link leads to Finance, which owns the figures;
      // no amount travels through the timeline.
      return has("finance:read") && entry.dossierId
        ? { href: `/files/${entry.dossierId}`, label: "Ouvrir la finance du dossier" }
        : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ UT-5
 * CUSTOMER wording.
 *
 * It lives in this module, beside the internal wording, so the two cannot drift
 * into describing the same event differently. What changes for a customer is
 * VOCABULARY, never substance: no plane names, no provenance jargon, no internal
 * actor. What does NOT change is honesty — a group whose order was never
 * recorded is still declared as such, in plainer words.
 */

/** How the customer is told where an entry came from. */
export const CUSTOMER_SOURCE_LABEL_FR: Record<"decision" | "observation", string> = {
  decision: "Confirmé par Effitrans",
  observation: "Information transmise par le transporteur",
};

/**
 * The customer-facing statement for simultaneous entries.
 *
 * Deliberately plainer than the internal notice, and deliberately NOT softer:
 * telling a customer a sequence we never recorded would be the one failure this
 * whole programme exists to prevent.
 */
export const CUSTOMER_UNPROVABLE_NOTICE =
  "Ces évènements ont été enregistrés au même moment. Leur ordre exact n'est pas connu.";

/**
 * An observation the platform did not confirm itself.
 *
 * ESTIMATED and INFERRED are both derivations, not sightings — the customer is
 * told so plainly rather than shown the internal confidence vocabulary. MANUAL
 * and CONFIRMED are omitted deliberately: a colleague who keyed a milestone in
 * did observe it.
 */
export function isUnconfirmed(c: UnifiedEntry["confidence"]): boolean {
  return c === "ESTIMATED" || c === "INFERRED";
}

/** Screen-reader sentence for a customer entry — no internal vocabulary. */
export function describeCustomerEntry(e: UnifiedEntry): string {
  const parts = [e.label, CUSTOMER_SOURCE_LABEL_FR[e.plane]];
  if (e.locationName) parts.push(e.locationName);
  if (e.plane === "observation" && isUnconfirmed(e.confidence)) {
    parts.push("information non confirmée par Effitrans");
  }
  if (!e.chronologyProvable) {
    parts.push("l'ordre de cet évènement par rapport aux autres du même instant n'est pas connu");
  }
  return parts.join(". ") + ".";
}
