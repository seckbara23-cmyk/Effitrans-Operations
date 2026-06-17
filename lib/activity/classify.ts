/**
 * Recent-activity classification (Dashboard UX) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Maps audit_log action codes to a French label + a category badge, and marks
 * finance-sensitive events so they can be withheld from viewers lacking
 * finance:read. Only allow-listed actions surface on the dashboard feed — this
 * is a curated read of the EXISTING audit_log, not a new event system.
 */
export type ActivityCategory = "user" | "document" | "customs" | "transport" | "finance" | "handoff" | "comms";

export type ActivityMeta = { label: string; category: ActivityCategory; financeSensitive: boolean };

const ACTIVITY_META: Record<string, ActivityMeta> = {
  "user.created": { label: "Utilisateur créé", category: "user", financeSensitive: false },
  "document.uploaded": { label: "Document téléversé", category: "document", financeSensitive: false },
  "document.approved": { label: "Document validé", category: "document", financeSensitive: false },
  "customs.declared": { label: "Déclaration douane", category: "customs", financeSensitive: false },
  "customs.released": { label: "Mainlevée douane", category: "customs", financeSensitive: false },
  "transport.picked_up": { label: "Enlèvement effectué", category: "transport", financeSensitive: false },
  "transport.delivered": { label: "Livraison effectuée", category: "transport", financeSensitive: false },
  "transport.pod_received": { label: "POD reçu", category: "transport", financeSensitive: false },
  "invoice.issued": { label: "Facture émise", category: "finance", financeSensitive: true },
  "payment.recorded": { label: "Paiement enregistré", category: "finance", financeSensitive: true },
  "payment.verified": { label: "Paiement vérifié", category: "finance", financeSensitive: true },
  "handoff.task.created": { label: "Transfert créé", category: "handoff", financeSensitive: false },
  "handoff.task.completed": { label: "Transfert terminé", category: "handoff", financeSensitive: false },
  "communication.sent": { label: "Communication envoyée", category: "comms", financeSensitive: false },
};

export function activityMeta(action: string): ActivityMeta | null {
  return ACTIVITY_META[action] ?? null;
}

/** True if the action is allow-listed AND the viewer may see it (finance gate). */
export function isActivityVisible(action: string, canSeeFinance: boolean): boolean {
  const meta = ACTIVITY_META[action];
  if (!meta) return false;
  if (meta.financeSensitive && !canSeeFinance) return false;
  return true;
}
