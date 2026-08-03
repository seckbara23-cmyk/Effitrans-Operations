/**
 * EC-3B/EC-3D — the quotation RPC error vocabulary. PURE.
 * ---------------------------------------------------------------------------
 * Extracted from actions.ts so the conversion module (EC-3D) maps the same
 * SQLSTATEs to the same names instead of keeping a second copy that drifts.
 * A plain module, not a "use server" one: it exports data and a sync function,
 * which a server-action file may not do.
 */
export const RPC_ERRORS: Record<string, string> = {
  QT600: "request_not_found", QT601: "quotation_not_found", QT602: "not_draft", QT603: "no_lines",
  QT604: "invalid_decision", QT605: "not_pending_validation",
  QT606: "same_actor", QT607: "reason_required", QT608: "not_validated",
  QT609: "not_sent", QT610: "quotation_immutable", QT611: "terminal",
  QT612: "lines_frozen", QT613: "invalid_acceptance_kind",
  QT614: "not_revisable", QT615: "reason_required", QT616: "not_accepted",
  QT617: "dossier_not_found",
};

export function mapRpcError(e: { code?: string; message?: string } | null): {
  error: string; detail?: string;
} {
  return { error: (e?.code && RPC_ERRORS[e.code]) || "save_failed", detail: e?.message };
}
