/**
 * HR-6 — training register PRIMITIVES. PURE. No imports, no I/O, no server-only.
 * Split out for the client workspace, the same way lib/hr/leave/balance.ts is.
 *
 * These are REGISTER vocabulary types: what a training is, whether someone holds
 * it, when it lapses. There is deliberately no lesson, module, chapter, quiz or
 * player type in this file — HR-6 tracks requirements and evidence, and the
 * delivery happens at the provider.
 */

/** Look-ahead for "certificate expiring soon". A display window, not a rule. */
export const CERTIFICATE_EXPIRY_WINDOW_DAYS = 60;

export type DeliveryMode = "IN_PERSON" | "ONLINE" | "INTERNAL" | "EXTERNAL" | "CERTIFICATION";
export type EnrollmentStatus =
  | "PLANNED" | "ENROLLED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";

export const DELIVERY_MODE_FR: Record<DeliveryMode, string> = {
  IN_PERSON: "Présentiel",
  ONLINE: "En ligne",
  INTERNAL: "Interne",
  EXTERNAL: "Externe",
  CERTIFICATION: "Certification",
};

export const ENROLLMENT_STATUS_FR: Record<EnrollmentStatus, string> = {
  PLANNED: "Planifiée",
  ENROLLED: "Inscrit",
  IN_PROGRESS: "En cours",
  COMPLETED: "Terminée",
  FAILED: "Échec",
  CANCELLED: "Annulée",
};

/** Statuses that still expect work. Used for "open" and "overdue" everywhere. */
export const OPEN_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "PLANNED", "ENROLLED", "IN_PROGRESS",
] as const;

/** Terminal statuses. A retake is a NEW enrollment, never a reopened one. */
export const CLOSED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "COMPLETED", "FAILED", "CANCELLED",
] as const;

export type TrainingCourse = {
  id: string; code: string; title: string; provider: string | null;
  category: string | null; deliveryMode: DeliveryMode; durationMinutes: number | null;
  validityMonths: number | null; isMandatory: boolean; requiresEvidence: boolean;
  isActive: boolean; targetOrgUnitId: string | null; targetPositionId: string | null;
};

export type TrainingEnrollment = {
  id: string; employeeId: string; courseId: string; planId: string | null;
  status: EnrollmentStatus; plannedDate: string | null; dueDate: string | null;
  completedOn: string | null; result: string | null; expiryDate: string | null;
  certificateDocumentId: string | null; providerReference: string | null;
  note: string | null;
};

export type TrainingPlan = {
  id: string; employeeId: string; labelFr: string;
  periodStart: string; periodEnd: string; status: string; note: string | null;
};

/** Open past its due date. A date comparison — nothing is inferred or scored. */
export function isOverdue(e: TrainingEnrollment, today: string): boolean {
  return e.dueDate !== null && e.dueDate < today
    && (OPEN_ENROLLMENT_STATUSES as readonly string[]).includes(e.status);
}
