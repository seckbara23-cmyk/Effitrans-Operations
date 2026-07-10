/**
 * Portal credentials email content (Phase 3.2B) — PURE, unit-tested.
 * ---------------------------------------------------------------------------
 * The OPTIONAL convenience email sent when the admin ticks "Envoyer les
 * identifiants par e-mail". By design it carries ONLY the login URL + login
 * email and states that the temporary password is communicated separately by
 * the Effitrans administrator. The password is included ONLY when BOTH the
 * PORTAL_ALLOW_PASSWORD_EMAIL feature flag is enabled AND the admin explicitly
 * opted in — the preferred configuration is to never email passwords at all.
 */
export type CredentialsEmailInput = {
  loginUrl: string;
  email: string;
  clientName?: string | null;
  /** Only ever true when the feature flag AND the admin checkbox both allow it. */
  includePassword: boolean;
  tempPassword?: string;
};

export type OutboundEmailContent = { subject: string; html: string; text: string };

/** Whether the temporary password may be placed in the email at all. */
export function passwordEmailAllowed(flagValue: string | undefined, adminOptedIn: boolean): boolean {
  return flagValue === "true" && adminOptedIn === true;
}

export function buildPortalCredentialsEmail(input: CredentialsEmailInput): OutboundEmailContent {
  const subject = "Votre accès au portail client Effitrans";
  const greeting = input.clientName ? `Bonjour ${input.clientName},` : "Bonjour,";

  const passwordBlock =
    input.includePassword && input.tempPassword
      ? [`Mot de passe temporaire : ${input.tempPassword}`, "Vous devrez le changer à la première connexion."]
      : [
          "Votre mot de passe temporaire vous sera communiqué séparément par votre",
          "administrateur Effitrans (téléphone, WhatsApp ou document remis en main propre).",
        ];

  const textLines = [
    greeting,
    "",
    "Un accès au portail client Effitrans a été créé pour vous.",
    "",
    `Adresse du portail : ${input.loginUrl}`,
    `Identifiant : ${input.email}`,
    ...passwordBlock,
    "",
    "À votre première connexion, vous devrez définir votre propre mot de passe.",
    "",
    "Cordialement,",
    "L'équipe Effitrans",
  ];

  const html =
    `<p>${greeting}</p>` +
    `<p>Un accès au portail client Effitrans a été créé pour vous.</p>` +
    `<p><strong>Adresse du portail :</strong> <a href="${input.loginUrl}">${input.loginUrl}</a><br/>` +
    `<strong>Identifiant :</strong> ${input.email}</p>` +
    `<p>${passwordBlock.join(" ")}</p>` +
    `<p>À votre première connexion, vous devrez définir votre propre mot de passe.</p>` +
    `<p>Cordialement,<br/>L'équipe Effitrans</p>`;

  return { subject, html, text: textLines.join("\n") };
}
