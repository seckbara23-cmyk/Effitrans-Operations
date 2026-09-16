/**
 * HR-IMPORT-MAPPING-01 — THE one way an imported value meets a catalog. PURE.
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES. Catalog lookups compared with a hand-rolled
 * `trim().toLowerCase()`, so « SIEGE » and « Siège » were different sites and
 * « DECLARANT EN DOUANE » could never match « Déclarant en douane ». The closed
 * vocabularies (département, type d'emploi, statut) meanwhile folded accents,
 * so one file could have its Département accepted and its Poste refused for the
 * very same kind of difference. Effitrans HR writes unaccented capitals; the
 * catalog is written in ordinary French. Both are correct spellings of one
 * value, and only the comparison was wrong.
 *
 * THE RATIFIED RULE (2026-09-16, ruling 1). Trim, collapse internal whitespace,
 * fold diacritics, fold case, then compare EXACTLY. Nothing fuzzy: no edit
 * distance, no prefix match, no token soup. « Chauffeur » never matches
 * « Chauffeurs », and it never will — a plural is a different value and HR
 * decides which one the catalog holds.
 *
 * AND AMBIGUITY IS A REFUSAL, NEVER A CHOICE. `unique (tenant_id, title)` is
 * case- and accent-SENSITIVE, so « Chauffeur » and « CHAUFFEUR » can both exist
 * in the catalog. Under this fold they are the same needle, and picking the
 * first row would attach half the drivers to one entry and half to the other
 * depending on row order. The import stops and names the problem instead.
 *
 * WHERE IT IS USED, and where it deliberately is NOT: the Poste, Site and Unité
 * lookups and the Responsable identifier. NOT the homonym guard — folding names
 * would make « Marie-José » and « marie jose » the same person, which is a
 * different ruling with different consequences and nobody has made it.
 */

/**
 * The canonical comparison form of an HR value.
 *
 * Order is deliberate: diacritics are folded on the decomposed form FIRST (so
 * « É » loses its accent rather than surviving as one code point), then runs of
 * whitespace — including the non-breaking spaces Excel copy-paste leaves
 * behind — collapse to one, then the edges are trimmed, then case is folded.
 */
/** U+0300..U+036F — the combining marks NFD leaves behind. */
const DIACRITICS = new RegExp("[\u0300-\u036f]", "g");

export function hrFold(value: string): string {
  return value
    .normalize("NFD")
    // Explicit ASCII escapes on purpose: the combining marks U+0300..U+036F
    // written literally are invisible in a source file, and an editor that
    // normalises them would silently turn the fold into a no-op.
    .replace(DIACRITICS, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Two values that mean the same catalog entry under the ratified fold. */
export function hrFoldEquals(a: string, b: string): boolean {
  return hrFold(a) === hrFold(b);
}

/**
 * The three answers a lookup may give. « none » and « ambiguous » are
 * different facts needing different acts — one is data HR must add, the other
 * is a catalog HR must clean — so they are never collapsed into a single
 * « introuvable ».
 */
export type HrResolution<T> =
  | { kind: "match"; value: T }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

/**
 * Resolve `needle` against `candidates` on `keyOf`, under the ratified fold.
 *
 * An empty needle resolves to nothing rather than to the first row with an
 * empty key: « rien » is not a lookup.
 */
export function resolveByFold<T>(
  candidates: readonly T[],
  keyOf: (candidate: T) => string | null | undefined,
  needle: string,
): HrResolution<T> {
  const target = hrFold(needle);
  if (!target) return { kind: "none" };

  // ONE guard, above: an empty needle already returned. Re-testing the KEY for
  // emptiness here would be a second spelling of the same protection, and a
  // duplicated guard is how one of them quietly stops being load-bearing.
  const hits = candidates.filter((c) => {
    const key = keyOf(c);
    return typeof key === "string" && hrFold(key) === target;
  });

  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", count: hits.length };
  return { kind: "match", value: hits[0] };
}
