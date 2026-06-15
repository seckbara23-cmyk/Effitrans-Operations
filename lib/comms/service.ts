/**
 * Communications reads (Phase 1.14). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Staff-role gated (communication:read) + tenant scope. Service-role admin
 * client; the RLS policy (tenant + communication:read) is the CI-tested
 * boundary. Used by the log, the dossier timeline, and the client history.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import type { CommunicationMessage, CommunicationStatus } from "./types";

const COLS =
  "id, recipient_email, recipient_name, template_key, subject, status, related_entity, file_id, client_id, retry_count, last_error, sent_at, created_at";

type Row = {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  template_key: string;
  subject: string;
  status: string;
  related_entity: string | null;
  file_id: string | null;
  client_id: string | null;
  retry_count: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

function toMessage(r: Row): CommunicationMessage {
  return {
    id: r.id,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name,
    templateKey: r.template_key,
    subject: r.subject,
    status: r.status as CommunicationStatus,
    relatedEntity: r.related_entity,
    fileId: r.file_id,
    clientId: r.client_id,
    retryCount: r.retry_count,
    lastError: r.last_error,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

async function query(filters: { status?: string; fileId?: string; clientId?: string }): Promise<CommunicationMessage[]> {
  const user = await assertPermission("communication:read");
  const supabase = getAdminSupabaseClient();
  let q = supabase.from("communication_message").select(COLS).eq("tenant_id", user.tenantId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.fileId) q = q.eq("file_id", filters.fileId);
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  const { data, error } = await q.order("created_at", { ascending: false }).returns<Row[]>();
  if (error) throw new Error(`[comms] list failed: ${error.message}`);
  return (data ?? []).map(toMessage);
}

export function listCommunications(opts?: { status?: string }): Promise<CommunicationMessage[]> {
  return query({ status: opts?.status });
}
export function listCommunicationsForFile(fileId: string): Promise<CommunicationMessage[]> {
  return query({ fileId });
}
export function listCommunicationsForClient(clientId: string): Promise<CommunicationMessage[]> {
  return query({ clientId });
}
