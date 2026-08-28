/**
 * Values and types for the report lifecycle.
 *
 * A PLAIN module: `report-actions.ts` carries "use server" and such a file may
 * export only async functions.
 */
export type ReportActionResult = { ok: true; id: string } | { ok: false; error: string };

/** Refusals, in the operator's language. */
export const REPORT_MESSAGES_FR: Record<string, string> = {
  forbidden: "Vous ne portez pas l'autorisation nécessaire pour cette action.",
  title_required: "Un titre est obligatoire.",
  not_found: "Rapport introuvable.",
  published_is_frozen:
    "Ce rapport est publié : il est figé. Ouvrez un nouveau rapport pour la période plutôt que de réécrire celui-ci.",
  already_published: "Ce rapport est déjà publié.",
  not_ready_for_review:
    "Seul un rapport « prêt pour revue » peut être publié. Soumettez-le d'abord à la revue.",
  invalid_state: "Le rapport n'est plus dans l'état attendu — rechargez la page.",
  no_change: "Aucune modification.",
  insert_failed: "La création a été refusée.",
  update_failed: "L'enregistrement a été refusé.",
  publish_failed: "La publication a été refusée par la base.",
};

export const sayReport = (code?: string) =>
  REPORT_MESSAGES_FR[code ?? ""] ?? "Action refusée.";
