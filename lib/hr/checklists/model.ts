/**
 * HR-4/HR-8 — checklist template vocabulary. PURE (no server-only import):
 * the configuration panel is a client component and must be able to read the
 * kinds and their French labels. Reads live in ../checklists.ts, writes in
 * ../checklist-actions.ts. (Same split as lib/hr/payroll/model.ts.)
 */
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
export type ChecklistTemplate = Tbl["hr_checklist_template"]["Row"];
export type ChecklistItemTemplate = Tbl["hr_checklist_item_template"]["Row"];

/** Exactly the vocabulary migration 111 constrains — never a second list. */
export const CHECKLIST_KINDS = ["ONBOARDING", "OFFBOARDING"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const CHECKLIST_KIND_LABEL_FR: Record<ChecklistKind, string> = {
  ONBOARDING: "Intégration",
  OFFBOARDING: "Départ",
};

export function isChecklistKind(v: unknown): v is ChecklistKind {
  return typeof v === "string" && (CHECKLIST_KINDS as readonly string[]).includes(v);
}
