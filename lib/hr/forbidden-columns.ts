/**
 * HR-IMPORT-MAPPING-01 — data the employee registry must never receive. PURE.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, from production. A reformatted workbook was uploaded with
 * Effitrans's own columns under the template's headers. Forty-nine national-ID
 * numbers and forty-nine gender values were written verbatim into
 * `hr_import_staging_row.raw`, and each row's national ID was then quoted back
 * inside a French validation message. Nothing was ever applied — the registry
 * itself refuses those fields — but the platform had already stored and
 * repeated data it is forbidden to hold.
 *
 * DEC-B27 (ratified, restated by the HR-0F architecture freeze) is
 * unconditional: the employee registry carries NO salary or compensation, NO
 * national identity number, NO passport, NO date of birth, NO gender, NO
 * marital status and NO medical column, EVER. The social-body identifiers
 * (IPRES, CSS, IPM) belong to the separate HR-3 identifier set gated on
 * DEC-B63, never to this import.
 *
 * So the refusal moves to the EARLIEST point that can see the column names:
 * before the batch row, before the staging rows, before validation. A file
 * carrying a prohibited column is refused whole, and nothing about it is kept.
 *
 * ⚠ THE REFUSAL NAMES THE COLUMN AND NEVER READS IT. The header is operator
 * guidance; a cell value is the very thing this module exists to keep out of
 * the database, the logs and the screens. Nothing here is passed a row.
 *
 * DETECTION IS CONSERVATIVE, NOT CLEVER. Whole tokens and whole phrases on the
 * folded header — never a substring of a word — so « Date d'entrée » is not
 * mistaken for a date of birth. The matcher may refuse a file HR could have
 * sent; it must never accept one it should not. The template documents the
 * prohibited list so the refusal is never a surprise.
 */
import { hrFold } from "./normalize";

export type ForbiddenColumnFinding = {
  /** The header EXACTLY as the file spells it — a name, never a value. */
  header: string;
  /** What kind of prohibited data it declares, in French. */
  reasonFr: string;
};

type ForbiddenCategory = {
  reasonFr: string;
  /** Whole words of the folded header. */
  tokens: readonly string[];
  /** Whole phrases contained in the folded header. */
  phrases: readonly string[];
};

/**
 * The prohibited families, each traceable to DEC-B27 or to the HR-3 identifier
 * gate. Spellings cover the French and English forms an HR workbook uses; the
 * fold already covers accents, case and spacing.
 */
const FORBIDDEN: readonly ForbiddenCategory[] = [
  {
    reasonFr: "pièce d'identité (CNI, passeport, numéro national)",
    tokens: ["cni", "nin", "passeport", "passport"],
    phrases: [
      "carte d identite", "carte nationale", "piece d identite",
      "numero d identite", "numero national", "national id", "id number",
    ],
  },
  {
    reasonFr: "sexe ou genre",
    tokens: ["sexe", "genre", "gender", "sex"],
    phrases: [],
  },
  {
    reasonFr: "date ou lieu de naissance",
    tokens: ["naissance", "dob"],
    phrases: ["date of birth", "birth date", "birthdate"],
  },
  {
    reasonFr: "situation familiale",
    tokens: ["matrimoniale", "matrimonial", "marital"],
    phrases: ["situation de famille", "etat civil", "nombre d enfants"],
  },
  {
    reasonFr: "rémunération",
    tokens: [
      "salaire", "salaires", "salary", "remuneration", "wage", "wages",
      "prime", "primes", "indemnite", "indemnites", "bonus", "compensation",
    ],
    phrases: ["net a payer", "masse salariale", "grille salariale"],
  },
  {
    reasonFr: "données médicales",
    tokens: ["medical", "medicale", "sante", "handicap", "maladie"],
    phrases: ["groupe sanguin", "dossier medical", "visite medicale"],
  },
  {
    reasonFr: "identifiant d'organisme social (IPRES, CSS, IPM)",
    tokens: ["ipres", "css", "ipm"],
    phrases: ["securite sociale", "numero de securite"],
  },
];

/**
 * The detection form of a header: the ratified fold, with apostrophes read as
 * word breaks so « carte d'identité » and « carte d identite » are one phrase.
 */
function detectionForm(header: string): string {
  return hrFold(header)
    .replace(/['’`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The prohibited family this header declares, or null. */
export function forbiddenColumnReason(header: string): string | null {
  const form = detectionForm(header);
  if (!form) return null;
  const words = new Set(form.split(" "));
  for (const category of FORBIDDEN) {
    if (category.tokens.some((t) => words.has(t))) return category.reasonFr;
    if (category.phrases.some((p) => form.includes(p))) return category.reasonFr;
  }
  return null;
}

/**
 * Every prohibited column in a header row, in the order the file declares them.
 * Returns an empty array for a file the registry may legitimately receive.
 */
export function forbiddenColumns(headers: readonly string[]): ForbiddenColumnFinding[] {
  const found: ForbiddenColumnFinding[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    const reasonFr = forbiddenColumnReason(header);
    if (!reasonFr) continue;
    const key = detectionForm(header);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ header: header.trim(), reasonFr });
  }
  return found;
}

/** The operator-facing list, for the template's Instructions sheet. */
export const FORBIDDEN_COLUMN_LABELS_FR: readonly string[] = FORBIDDEN.map((c) => c.reasonFr);
