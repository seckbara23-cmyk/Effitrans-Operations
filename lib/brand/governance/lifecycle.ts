/**
 * Template lifecycle (DBC-6). PURE — the governance state machine.
 * ---------------------------------------------------------------------------
 * DRAFT → APPROVED → PUBLISHED → RETIRED, applied uniformly to every template category. A
 * simple, explicit state machine (no multi-approver workflow yet). PUBLISH additionally
 * requires brand readiness — the caller enforces that; here we only govern transitions.
 */
export const TEMPLATE_CATEGORIES = ["SIGNATURE", "DOCUMENT", "PRESENTATION", "COMMUNICATION", "MARKETING_EMAIL"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export function isTemplateCategory(v: string): v is TemplateCategory {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

export const LIFECYCLE_STATES = ["DRAFT", "APPROVED", "PUBLISHED", "RETIRED"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export function isLifecycleState(v: string): v is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(v);
}

export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  DRAFT: ["APPROVED"],
  APPROVED: ["PUBLISHED", "DRAFT"],
  PUBLISHED: ["RETIRED", "APPROVED"],
  RETIRED: ["DRAFT"],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

export const LIFECYCLE_LABEL: Record<LifecycleState, string> = {
  DRAFT: "Brouillon", APPROVED: "Approuvé", PUBLISHED: "Publié", RETIRED: "Retiré",
};

/** Only a PUBLISHED template is production-usable. */
export function isPublishable(to: LifecycleState): boolean {
  return to === "PUBLISHED";
}
