/**
 * Communications shared types (Phase 1.14). Client + server safe.
 */
export type CommunicationStatus = "QUEUED" | "SENT" | "FAILED" | "CANCELLED";

export type CommunicationMessage = {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  templateKey: string;
  subject: string;
  status: CommunicationStatus;
  relatedEntity: string | null;
  fileId: string | null;
  clientId: string | null;
  retryCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type ActionResult =
  | { ok: true; id?: string; count?: number }
  | { ok: false; error: string };
