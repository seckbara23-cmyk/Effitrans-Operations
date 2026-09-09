/**
 * What an operator READS about a step. PURE — no decisions, only words.
 * ---------------------------------------------------------------------------
 * Everything here is derived from a verdict the server already computed. It
 * decides nothing: `evaluateStepAction` says what may be done and this says how
 * to name it, so a card cannot come to a different conclusion from the button
 * next to it.
 *
 * THE VOCABULARY IS RATIFIED and deliberately small: Disponible, À votre tour,
 * En cours, En attente, Bloquée, Terminée. Internal codes — `step_closed`,
 * `assigned_to_another`, `evidence_missing` — never reach a screen; they resolve
 * through `error-fr.ts`. And no state is carried by colour alone: every tone
 * comes with its own word, because a status a colour-blind reader cannot read is
 * not a status.
 */
import type { StepEligibility } from "../step-eligibility";

export type ContextualStatusKey =
  | "a_votre_tour"
  | "disponible"
  | "en_cours"
  | "en_attente"
  | "bloquee"
  | "terminee"
  | "rejetee"
  | "sans_objet"
  /**
   * Open, legitimate, and somebody ELSE's. Added 2026-09-07 because it was
   * being rendered as « Bloquée »: on dossier 00011 step 14 was AVAILABLE and
   * perfectly healthy, and a Déclarant read « Transport — Bloquée » simply
   * because the step was not his. Nothing was blocked. « En attente » would
   * have been just as wrong: nobody is waiting on anything.
   */
  | "autre_service";

export type ContextualStatus = {
  key: ContextualStatusKey;
  labelFr: string;
  /** Tailwind classes. Never the only carrier of the meaning — see the label. */
  tone: string;
};

const STATUS: Record<ContextualStatusKey, { labelFr: string; tone: string }> = {
  a_votre_tour: { labelFr: "À votre tour", tone: "bg-teal-50 text-teal-800 border-teal-200" },
  disponible: { labelFr: "Disponible", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  en_cours: { labelFr: "En cours", tone: "bg-blue-50 text-blue-800 border-blue-200" },
  en_attente: { labelFr: "En attente", tone: "bg-slate-50 text-slate-600 border-slate-200" },
  bloquee: { labelFr: "Bloquée", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  terminee: { labelFr: "Terminée", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  rejetee: { labelFr: "Rejetée", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  sans_objet: { labelFr: "Sans objet", tone: "bg-slate-50 text-slate-500 border-slate-200" },
  autre_service: { labelFr: "Autre service", tone: "bg-slate-50 text-slate-600 border-slate-200" },
};

const TERMINAL_DONE = new Set(["COMPLETED", "APPROVED"]);

/**
 * The one word for where this step stands, for THIS reader.
 *
 * « À votre tour » is a statement about the reader, not about the step, and is
 * the whole reason a contextual surface is worth building: on the dossier page
 * an operator should be able to see, without reading 26 rows, that one of them
 * is waiting for them specifically.
 */
export function contextualStatus(state: string, eligibility: StepEligibility): ContextualStatus {
  const key = statusKey(state, eligibility);
  return { key, ...STATUS[key] };
}

function statusKey(state: string, e: StepEligibility): ContextualStatusKey {
  if (TERMINAL_DONE.has(state)) return "terminee";
  // A service Effitrans is not providing outranks every other reading: it is
  // not missing, not pending and not blocked.
  if (e.notApplicable) return "sans_objet";
  if (state === "SKIPPED" || state === "CANCELLED") return "sans_objet";
  if (state === "REJECTED") return "rejetee";
  // PENDING is « not yet open » and must never read as finished — the UI-1
  // confusion, in its status form.
  if (state === "PENDING") return "en_attente";
  if (e.canStart || e.canSubmit) return "a_votre_tour";
  if (state === "ACTIVE") return "en_cours";
  if (state === "BLOCKED") return "bloquee";
  // AVAILABLE or SUBMITTED, and not this reader's to act on right now.
  //
  // « NOT YOURS » IS NOT « BLOCKED », and conflating them is what made a
  // healthy step 14 read « Bloquée » to a Déclarant. A step waiting for its own
  // department is progressing normally; only custody and an outstanding
  // BLOCKING requirement genuinely stop it.
  //
  // UAT-STEP10-HANDOFF-01 — read the VERDICT, not the state. This asked the raw
  // custody state and so called « Bloquée » on every routed step awaiting
  // transmission, including the three routes that do not require reception and
  // that the engine happily runs. Step 10 of EFT-IMP-2026-00011 read
  // « Bloquée » to its own Coordinator while `activateStep` would have
  // accepted it. `custodyRefusal` is null exactly when custody stops nothing.
  const custodyStopped = e.custodyRefusal !== null;
  if (custodyStopped || e.requirements.some((r) => r.blocking)) return "bloquee";
  if (e.claimedByAnother) return "en_cours";
  if (!e.isOwner || !e.mayAct) return "autre_service";
  if (e.reasonFr) return "bloquee";
  return "disponible";
}

/**
 * Is there anything worth drawing for this reader at all?
 *
 * A step that will never be this person's, is finished, and has nothing to say
 * is noise. Contextual means « what concerns you here », not « the whole
 * process again in a smaller font » — /process remains the complete view.
 */
export function worthShowing(state: string, eligibility: StepEligibility): boolean {
  // Out of scope: reported on /process, where the complete picture belongs, and
  // never repeated as a contextual card. « The service was not requested » is
  // not work, and a dossier page full of it is noise.
  if (eligibility.notApplicable) return false;
  if (eligibility.canStart || eligibility.canSubmit) return true;
  if (TERMINAL_DONE.has(state) || state === "SKIPPED" || state === "CANCELLED") return false;
  if (state === "PENDING") return false; // upcoming work belongs on /process
  // Open, and either the reader's own or explained.
  return eligibility.isOwner || eligibility.mayAct || Boolean(eligibility.reasonFr);
}
