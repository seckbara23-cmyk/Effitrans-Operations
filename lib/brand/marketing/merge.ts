/**
 * Merge-tag abstraction (DBC-6). PURE.
 * ---------------------------------------------------------------------------
 * The compiler emits CANONICAL tags ({{FIRST_NAME}}, …). Provider adapters translate them
 * to each ESP's syntax — provider syntax is NEVER hardcoded in a template. No provider API,
 * no secrets: this only rewrites placeholder text.
 */
import type { EmailProvider } from "./registry";

export const MERGE_TAGS = ["FIRST_NAME", "LAST_NAME", "EMAIL", "COMPANY", "UNSUBSCRIBE_URL"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];

const SYNTAX: Record<EmailProvider, Record<MergeTag, string>> = {
  generic: { FIRST_NAME: "{{FIRST_NAME}}", LAST_NAME: "{{LAST_NAME}}", EMAIL: "{{EMAIL}}", COMPANY: "{{COMPANY}}", UNSUBSCRIBE_URL: "{{UNSUBSCRIBE_URL}}" },
  mailchimp: { FIRST_NAME: "*|FNAME|*", LAST_NAME: "*|LNAME|*", EMAIL: "*|EMAIL|*", COMPANY: "*|COMPANY|*", UNSUBSCRIBE_URL: "*|UNSUB|*" },
  hubspot: { FIRST_NAME: "{{ contact.firstname }}", LAST_NAME: "{{ contact.lastname }}", EMAIL: "{{ contact.email }}", COMPANY: "{{ contact.company }}", UNSUBSCRIBE_URL: "{{ unsubscribe_link }}" },
  dynamics: { FIRST_NAME: "{{FirstName}}", LAST_NAME: "{{LastName}}", EMAIL: "{{EmailAddress}}", COMPANY: "{{CompanyName}}", UNSUBSCRIBE_URL: "{{Unsubscribe}}" },
};

/** Replace every canonical {{TAG}} with the chosen provider's syntax. Unknown tags are left. */
export function applyMergeTags(html: string, provider: EmailProvider): string {
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (m, tag: string) => {
    const map = SYNTAX[provider];
    return (MERGE_TAGS as readonly string[]).includes(tag) ? map[tag as MergeTag] : m;
  });
}

/** The provider's unsubscribe placeholder (for the mandatory footer). */
export function unsubscribeTag(provider: EmailProvider): string {
  return SYNTAX[provider].UNSUBSCRIBE_URL;
}
