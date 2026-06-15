/**
 * Email template catalog (Phase 1.14) — PURE data, client + server safe.
 * ---------------------------------------------------------------------------
 * French-first transactional templates with {{var}} placeholders. English (_en)
 * + DB-editable templates are deferred. The renderer (./render) interpolates +
 * HTML-escapes values and wraps the body in Effitrans branding.
 */
export type TemplateKey =
  | "portal_invite"
  | "task_assigned"
  | "document_shared"
  | "invoice_issued"
  | "payment_recorded"
  | "payment_link"
  | "customs_released"
  | "transport_delivered"
  | "pod_received";

export type Template = { subject: string; html: string; text: string };

export const TEMPLATES: Record<TemplateKey, Template> = {
  portal_invite: {
    subject: "Invitation à l'espace client Effitrans",
    html: "<p>Bonjour {{clientName}},</p><p>{{inviterName}} vous invite à accéder à votre espace client Effitrans pour suivre vos dossiers.</p><p><a href=\"{{inviteLink}}\">Activer mon accès</a></p>",
    text: "Bonjour {{clientName}},\n{{inviterName}} vous invite à accéder à votre espace client Effitrans.\nActiver : {{inviteLink}}",
  },
  task_assigned: {
    subject: "Tâche assignée : {{taskTitle}}",
    html: "<p>{{assignerName}} vous a assigné la tâche « {{taskTitle}} » sur le dossier {{fileNumber}}.</p><p>Échéance : {{dueDate}}</p>",
    text: "{{assignerName}} vous a assigné « {{taskTitle}} » (dossier {{fileNumber}}). Échéance : {{dueDate}}",
  },
  document_shared: {
    subject: "Nouveau document partagé — dossier {{fileNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>Un document « {{documentType}} » a été partagé pour votre dossier {{fileNumber}}.</p><p><a href=\"{{portalLink}}\">Voir dans mon espace client</a></p>",
    text: "Bonjour {{clientName}},\nUn document « {{documentType}} » a été partagé pour le dossier {{fileNumber}}.\nEspace client : {{portalLink}}",
  },
  invoice_issued: {
    subject: "Facture {{invoiceNumber}} — Effitrans",
    html: "<p>Bonjour {{clientName}},</p><p>Votre facture <strong>{{invoiceNumber}}</strong> d'un montant de {{total}} est disponible.</p><p>Échéance : {{dueDate}}</p><p><a href=\"{{portalLink}}\">Consulter la facture</a></p>",
    text: "Bonjour {{clientName}},\nVotre facture {{invoiceNumber}} ({{total}}) est disponible. Échéance : {{dueDate}}.\nConsulter : {{portalLink}}",
  },
  payment_recorded: {
    subject: "Paiement enregistré — facture {{invoiceNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>Nous avons enregistré un paiement de {{amount}} sur la facture {{invoiceNumber}}.</p><p>Solde restant : {{balance}}</p>",
    text: "Bonjour {{clientName}},\nPaiement de {{amount}} enregistré sur la facture {{invoiceNumber}}. Solde restant : {{balance}}.",
  },
  payment_link: {
    subject: "Lien de paiement — facture {{invoiceNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>Réglez votre facture <strong>{{invoiceNumber}}</strong> d'un montant de {{amount}} en ligne :</p><p><a href=\"{{paymentLink}}\">Payer maintenant</a></p>",
    text: "Bonjour {{clientName}},\nRéglez votre facture {{invoiceNumber}} ({{amount}}) en ligne : {{paymentLink}}",
  },
  customs_released: {
    subject: "Dédouanement libéré — dossier {{fileNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>Le dédouanement de votre dossier {{fileNumber}} est libéré (BAE : {{baeReference}}).</p>",
    text: "Bonjour {{clientName}},\nDédouanement libéré pour le dossier {{fileNumber}} (BAE : {{baeReference}}).",
  },
  transport_delivered: {
    subject: "Livraison effectuée — dossier {{fileNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>La livraison de votre dossier {{fileNumber}} a été effectuée le {{deliveryDate}}.</p>",
    text: "Bonjour {{clientName}},\nLivraison effectuée pour le dossier {{fileNumber}} le {{deliveryDate}}.",
  },
  pod_received: {
    subject: "Preuve de livraison reçue — dossier {{fileNumber}}",
    html: "<p>Bonjour {{clientName}},</p><p>La preuve de livraison (POD) de votre dossier {{fileNumber}} a été reçue. Merci de votre confiance.</p>",
    text: "Bonjour {{clientName}},\nLa preuve de livraison (POD) du dossier {{fileNumber}} a été reçue.",
  },
};
