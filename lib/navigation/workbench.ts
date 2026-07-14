/**
 * "Mon travail" — the workbench classifier (Phase 5.0E-1, Deliverable 3). PURE.
 * ---------------------------------------------------------------------------
 * The 5.0C version rendered six overlapping sections: one dossier could appear in
 * four of them at once, so no count on the page meant anything. This partitions
 * instead — FIRST MATCH WINS, every item lands in exactly ONE tab. That is what
 * makes a badge honest: "3 à valider" means three, not "three, some of which are
 * also the two below".
 *
 * The order of the tabs IS the order of urgency, and it is deliberate:
 *
 *   1. À réceptionner — nothing progresses until reception is confirmed. A dossier
 *      sitting unreceived is the single most common way work stalls invisibly, so
 *      it outranks even a correction.
 *   2. Corrections    — already rejected once; the client is already waiting.
 *   3. À valider      — someone else is blocked on your signature.
 *   4. À faire        — your own active work.
 *   5. À transmettre  — done by you, waiting on a handoff you must send.
 *   6. Bloqués        — a prerequisite or a piece of evidence is missing.
 *   7. Autre service  — the parallel branch has not converged. Not yours to fix.
 *   8. Terminés       — recently completed, for reference only.
 *
 * MAKER-CHECKER IS NOT RE-IMPLEMENTED HERE. The engine refuses a maker who tries to
 * approve their own submission, on IDENTITY, regardless of permission. This
 * classifier mirrors that same rule so the UI never *offers* work that the action
 * would then refuse — but the action remains the authority.
 */
import type { QueueItem } from "@/lib/process/queues/service";

export type WorkbenchTabKey =
  | "to_receive"
  | "corrections"
  | "to_validate"
  | "todo"
  | "to_forward"
  | "blocked"
  | "other_branch"
  | "done";

export type WorkbenchItem = QueueItem & { queueKey: string };

export type WorkbenchTab = {
  key: WorkbenchTabKey;
  label: string;
  /** What this tab means, in one line, for someone who has never used the app. */
  hint: string;
  items: WorkbenchItem[];
  /** Whether an empty tab is good news (nothing waiting) or just empty. */
  emptyLabel: string;
};

export const WORKBENCH_TAB_ORDER: WorkbenchTabKey[] = [
  "to_receive",
  "corrections",
  "to_validate",
  "todo",
  "to_forward",
  "blocked",
  "other_branch",
  "done",
];

const TAB_META: Record<WorkbenchTabKey, { label: string; hint: string; emptyLabel: string }> = {
  to_receive: {
    label: "À réceptionner",
    hint: "Un transfert vous a été envoyé. Rien ne progresse tant que vous ne l'avez pas réceptionné.",
    emptyLabel: "Aucun transfert en attente de réception.",
  },
  corrections: {
    label: "Corrections",
    hint: "Rejeté par un contrôleur indépendant, avec le motif. Le client attend déjà.",
    emptyLabel: "Aucune correction à reprendre.",
  },
  to_validate: {
    label: "À valider",
    hint: "Soumis par quelqu'un d'autre : votre validation débloque la suite.",
    emptyLabel: "Aucune validation en attente de vous.",
  },
  todo: {
    label: "À faire",
    hint: "Vos étapes en cours, prêtes à être traitées.",
    emptyLabel: "Rien à traiter.",
  },
  to_forward: {
    label: "À transmettre",
    hint: "Votre part est faite : soumis, en attente d'un contrôleur ou d'un transfert.",
    emptyLabel: "Rien à transmettre.",
  },
  blocked: {
    label: "Bloqués",
    hint: "Un prérequis ou une pièce justificative manque.",
    emptyLabel: "Aucune étape bloquée.",
  },
  other_branch: {
    label: "Autre service",
    hint: "La branche douane ou la préparation transport n'a pas encore convergé. Pas à vous de la débloquer.",
    emptyLabel: "Aucune attente sur une autre branche.",
  },
  done: {
    label: "Terminés",
    hint: "Récemment terminés, pour référence.",
    emptyLabel: "Rien de récent.",
  },
};

const DONE_STATES = new Set(["COMPLETED", "APPROVED"]);

/**
 * Which single tab does this item belong to, for THIS user? First match wins.
 * `null` means "not on your bench" — it is someone else's named work, and it
 * belongs in the department queue, not here.
 *
 * Exported so the ORDER is directly testable, not merely inferable from counts.
 */
export function classifyItem(item: WorkbenchItem, userId: string): WorkbenchTabKey | null {
  if (DONE_STATES.has(item.state)) return "done";

  const assignedToSomeoneElse = item.assigneeId !== null && item.assigneeId !== userId;
  const iSubmitted = item.submittedBy !== null && item.submittedBy === userId;

  // Maker-checker on IDENTITY: whoever submitted a step can never be the one to
  // approve it, even holding every permission in the tenant. A submitted step is
  // therefore a VALIDATION request for everyone except its own maker — including
  // when it is formally assigned to that maker.
  if (item.state === "SUBMITTED") {
    return iSubmitted ? "to_forward" : "to_validate";
  }

  // Everything below is work someone must physically do. If it already has a named
  // owner and that owner is not you, it is not your problem.
  if (assignedToSomeoneElse) return null;

  // A handoff sent but not received. The work belongs to nobody until it is
  // claimed — this is where dossiers go quiet, so it outranks everything else.
  if (item.receptionRequired && !item.received) return "to_receive";

  if (item.isCorrection) return "corrections";

  if (item.branches.waitingOnOtherBranch) return "other_branch";

  if (item.blockerSummary !== null) return "blocked";

  return "todo";
}

/** Partition a user's whole workload into the eight tabs. */
export function buildWorkbench(items: WorkbenchItem[], userId: string): WorkbenchTab[] {
  const byTab = new Map<WorkbenchTabKey, WorkbenchItem[]>(
    WORKBENCH_TAB_ORDER.map((k) => [k, []]),
  );

  for (const item of items) {
    const tab = classifyItem(item, userId);
    if (tab !== null) byTab.get(tab)!.push(item);
  }

  return WORKBENCH_TAB_ORDER.map((key) => {
    const tabItems = byTab.get(key)!;
    // Highest priority first inside a tab — the queue's own ranking, not a new one.
    tabItems.sort((a, b) => b.priority.score - a.priority.score);
    return { key, ...TAB_META[key], items: tabItems };
  });
}

/**
 * The count that belongs on a sidebar badge: work that is genuinely waiting on
 * THIS user. Deliberately excludes `blocked`, `other_branch` and `done` — a badge
 * must mean "you can act on this now", or people learn to ignore it.
 */
export function actionableCount(tabs: WorkbenchTab[]): number {
  const ACTIONABLE: WorkbenchTabKey[] = ["to_receive", "corrections", "to_validate", "todo"];
  return tabs
    .filter((t) => ACTIONABLE.includes(t.key))
    .reduce((n, t) => n + t.items.length, 0);
}
