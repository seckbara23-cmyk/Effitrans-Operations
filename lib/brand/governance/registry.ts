/**
 * Unified template registry (DBC-6). PURE.
 * ---------------------------------------------------------------------------
 * ONE catalog across every Brand Center template category — Signature / Document /
 * Presentation / Communication / Marketing Email. The governance dashboard iterates this ×
 * the lifecycle state. Future categories (website, social campaign) add an entry here; no
 * new registry.
 */
import { SIGNATURE_VARIANTS } from "@/lib/brand/model";
import { TEMPLATE_LIST } from "@/lib/brand/document/registry";
import { ACTIVE_PRESENTATIONS } from "@/lib/brand/presentation/registry";
import { COMMUNICATION_KINDS, COMMUNICATION_META } from "@/lib/brand/presentation/registry";
import { ACTIVE_MARKETING, MARKETING_LABEL } from "@/lib/brand/marketing/registry";
import type { TemplateCategory } from "./lifecycle";

export type UnifiedTemplate = { category: TemplateCategory; key: string; label: string };

const SIG_LABEL: Record<string, string> = { EXECUTIVE: "Signature — Direction", MANAGEMENT: "Signature — Management", CORPORATE: "Signature — Standard" };

export const UNIFIED_TEMPLATES: UnifiedTemplate[] = [
  ...SIGNATURE_VARIANTS.map((v) => ({ category: "SIGNATURE" as const, key: v, label: SIG_LABEL[v] ?? v })),
  ...TEMPLATE_LIST.map((t) => ({ category: "DOCUMENT" as const, key: t.type, label: t.label })),
  ...ACTIVE_PRESENTATIONS.map((p) => ({ category: "PRESENTATION" as const, key: p, label: `Présentation ${p}` })),
  ...COMMUNICATION_KINDS.map((k) => ({ category: "COMMUNICATION" as const, key: k, label: COMMUNICATION_META[k].label })),
  ...ACTIVE_MARKETING.map((m) => ({ category: "MARKETING_EMAIL" as const, key: m, label: `E-mail — ${MARKETING_LABEL[m]}` })),
];

export function findTemplate(category: string, key: string): UnifiedTemplate | undefined {
  return UNIFIED_TEMPLATES.find((t) => t.category === category && t.key === key);
}
