/**
 * Montant en lettres — French number-to-words (Phase 11.0C). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The « Montant en lettres » field of the two paper documents is a DERIVED value
 * (11.0A §11, classification D): the operator never types it, the platform spells
 * the amount exactly as the form requires. This module is the single source of
 * that spelling — the form renderer, the version snapshot and the UI preview all
 * call it, so the printed words can never disagree with the printed figures.
 *
 * French orthography implemented (Académie rules, the ones that actually appear
 * on a cheque or an expense form):
 *   * 17–19  → dix-sept … dix-neuf; 70–79 → soixante-dix … soixante-dix-neuf
 *   * 21/31/…/61 take « et un »; 71 takes « et onze »; 81/91 do NOT ("et" never
 *     follows quatre-vingt)
 *   * « quatre-vingts » and « cents » take a plural -s ONLY when they end the
 *     number or precede a NOUN scale (millions, milliards) — never before the
 *     numeral adjective « mille »: « deux cent mille », « quatre-vingt mille »,
 *     but « deux cents millions », « quatre-vingts millions »
 *   * « mille » is invariable and is never preceded by « un »
 *
 * Deterministic and total: the same amount always yields the same words, which is
 * what lets the words ride inside the hashed immutable version snapshot.
 */

const UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
];

const TENS: Record<number, string> = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
};

/**
 * 0–99. `beforeMille` suppresses the plural -s of « quatre-vingts » (the -s is
 * dropped before the numeral « mille »: « quatre-vingt mille »).
 */
function below100(n: number, beforeMille = false): string {
  if (n < 17) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;

  const t = Math.floor(n / 10);
  const u = n % 10;

  // 70–79: built on soixante + (10…19). 71 is the last « et » form.
  if (t === 7) return u === 1 ? "soixante et onze" : `soixante-${below100(10 + u)}`;
  // 80–89: « quatre-vingts » only when it ends the number; never « et un ».
  if (t === 8) return u === 0 ? (beforeMille ? "quatre-vingt" : "quatre-vingts") : `quatre-vingt-${UNITS[u]}`;
  // 90–99: quatre-vingt + (10…19).
  if (t === 9) return `quatre-vingt-${below100(10 + u)}`;

  const tens = TENS[t];
  if (u === 0) return tens;
  if (u === 1) return `${tens} et un`;
  return `${tens}-${UNITS[u]}`;
}

/**
 * 0–999. `beforeMille` suppresses the plural -s of « cents » (« deux cent mille »
 * vs « deux cents »).
 */
function below1000(n: number, beforeMille = false): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r, beforeMille);

  const head = h === 1 ? "cent" : `${UNITS[h]} cent`;
  if (r === 0) return h > 1 && !beforeMille ? `${head}s` : head;
  return `${head} ${below100(r, beforeMille)}`;
}

/** The noun scales. « mille » is a numeral adjective — invariable, never « un mille ». */
const SCALES: { value: number; singular: string; plural: string; noun: boolean }[] = [
  { value: 1_000_000_000, singular: "milliard", plural: "milliards", noun: true },
  { value: 1_000_000, singular: "million", plural: "millions", noun: true },
  { value: 1_000, singular: "mille", plural: "mille", noun: false },
];

/**
 * A non-negative integer in French words. Values above 999 999 999 999 are
 * beyond any plausible expense document and are rejected by the caller.
 */
export function integerToFrenchWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const whole = Math.floor(n);
  if (whole === 0) return "zéro";

  let rest = whole;
  const parts: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    if (count === 0) continue;
    rest -= count * scale.value;
    if (!scale.noun && count === 1) {
      parts.push(scale.singular); // « mille », never « un mille »
    } else {
      // Before « mille » the -s of cent/quatre-vingt is dropped; before a NOUN
      // scale (millions, milliards) it is kept.
      parts.push(`${below1000(count, !scale.noun)} ${count > 1 ? scale.plural : scale.singular}`);
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

/**
 * Currency wording + the number of minor units the currency actually uses. XOF
 * (franc CFA) has no minor unit in practice — an expense form never prints
 * centimes — so its fractional part is not spelled.
 */
const CURRENCIES: Record<string, { major: string; minor: string; decimals: number }> = {
  XOF: { major: "francs CFA", minor: "centimes", decimals: 0 },
  XAF: { major: "francs CFA", minor: "centimes", decimals: 0 },
  EUR: { major: "euros", minor: "centimes", decimals: 2 },
  USD: { major: "dollars US", minor: "cents", decimals: 2 },
  GBP: { major: "livres sterling", minor: "pence", decimals: 2 },
  MAD: { major: "dirhams", minor: "centimes", decimals: 2 },
};

/** Upper-case the first letter only — the form prints the words as a sentence. */
function sentenceCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * The « Montant en lettres » string for an amount, e.g.
 *   amountInWordsFr(1_250_000, "XOF") → « Un million deux cent cinquante mille francs CFA »
 *   amountInWordsFr(80_000, "XOF")    → « Quatre-vingt mille francs CFA »
 *   amountInWordsFr(1_234.5, "EUR")   → « Mille deux cent trente-quatre euros et cinquante centimes »
 *
 * An unknown currency code is spelled as-is (no invented denomination name).
 * Returns "" for a non-finite, negative or implausibly large amount, so a caller
 * can never print a half-computed value.
 */
export function amountInWordsFr(amount: number, currency = "XOF"): string {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) return "";

  const code = (currency || "XOF").trim().toUpperCase();
  const spec = CURRENCIES[code] ?? { major: code, minor: "", decimals: 2 };

  const whole = Math.floor(amount);
  const words = integerToFrenchWords(whole);
  const head = spec.major ? `${words} ${spec.major}` : words;

  if (spec.decimals === 0 || !spec.minor) return sentenceCase(head);

  // Round the minor units the same way the printed figure is rounded.
  const minor = Math.round((amount - whole) * 10 ** spec.decimals);
  if (minor <= 0) return sentenceCase(head);
  return sentenceCase(`${head} et ${integerToFrenchWords(minor)} ${spec.minor}`);
}
