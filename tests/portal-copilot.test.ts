/**
 * Phase 7.6C — Customer AI Assistant (Portal Copilot). The deterministic card engine, the
 * customer classifier/budget, the customs view and the prompt are exercised DIRECTLY (grounding,
 * Missing ≠ Negative, no fabricated ETA, customer-safe surface); the server-only
 * context/route/usage and the client panel are verified STRUCTURALLY (portal-identity gate with
 * NO permission escalation, RLS-only reads, reuse of the shared engine + budget + rate limiter,
 * safe portal-attributed audit, provider-down fallback, session-only history, no leaked
 * diagnostics).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildPortalRecommendations, portalDeterministicSummary } from "@/lib/portal/copilot/cards";
import { classifyPortalQuestion, portalSectionCaps, BUDGET, capSerialized } from "@/lib/portal/copilot/budget";
import { serializePortalContext, buildPortalSystemPrompt, buildPortalMessages } from "@/lib/portal/copilot/prompt";
import { portalCustomsView, portalMapSummary } from "@/lib/portal/copilot/view";
import { PORTAL_CARD_KINDS, PORTAL_SECTIONS, type PortalCopilotContext } from "@/lib/portal/copilot/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function ctx(over: Partial<PortalCopilotContext> = {}): PortalCopilotContext {
  return {
    generatedAt: "2026-07-17T10:00:00Z",
    questionClass: "general",
    scope: "shipment",
    clientName: "ACME SARL",
    sections: [...PORTAL_SECTIONS],
    unavailable: [],
    truncated: [],
    shipment: null,
    carriage: null,
    customs: null,
    portfolio: [],
    requirements: [],
    documents: [],
    invoices: [],
    notifications: [],
    activity: [],
    contact: null,
    counts: { portfolio: 0, requirements: 0, documents: 0, invoices: 0, notifications: 0, activity: 0 },
    ...over,
  };
}

const SHIPMENT: NonNullable<PortalCopilotContext["shipment"]> = {
  fileNumber: "EFT-IMP-2099-1",
  type: "IMPORT",
  route: "Shanghai → Dakar",
  currentStage: "in_transit",
  currentLocation: "En transit",
  currentDepartment: "Transport",
  progressPercent: 60,
  delay: { state: "warning", label: "Suivi recommandé", explanation: "Le traitement douanier prend plus de temps que prévu." },
  eta: { estimatedDate: "2026-07-25T00:00:00Z", basis: "scheduled_delivery", delayDays: 0, delivered: false },
  nextStep: { title: "Livraison", explanation: "Votre marchandise est en cours d'acheminement.", clientAction: null, party: "carrier" },
  transportStatusLabel: "En transit",
  lastActivityAt: "2026-07-16T08:00:00Z",
  podAvailable: false,
  link: "/portal/files/f1",
};

const FULL = ctx({
  shipment: SHIPMENT,
  carriage: {
    mode: "SEA",
    transportLabel: "Transport maritime",
    carrierOrVessel: "MSC ISABELLA",
    voyageOrFlight: "V123",
    milestoneLabel: "Chargé au port de départ",
    references: [{ label: "Connaissement (MBL)", value: "MBL-777" }],
    units: { heading: "Conteneurs", items: [{ label: "MSCU1234567", type: "40HC", status: "LOADED" }] },
    map: { hasGeo: true, positionLabel: "Port de Shanghai", positionAt: "2026-07-15T00:00:00Z", positionFreshness: "FRESH", milestoneCount: 3 },
  },
  customs: { state: "in_progress", label: "Dédouanement en cours" },
  requirements: [
    { label: "Connaissement", state: "requis" },
    { label: "Facture commerciale", state: "en_verification" },
    { label: "Liste de colisage", state: "valide" },
  ],
  documents: [{ typeLabel: "Facture commerciale", status: "APPROVED", createdAt: "2026-07-10T00:00:00Z", link: "/portal/files/f1" }],
  invoices: [{ invoiceNumber: "INV-01", status: "ISSUED", currency: "XOF", total: 1000, balance: 400, dueDate: "2026-07-01", overdue: true, link: "/portal/invoices/i1" }],
  notifications: [{ title: "Navire arrivé au port", category: "TRANSPORT", createdAt: "2026-07-15T00:00:00Z", read: false }],
  activity: [{ title: "Dossier créé", date: "2026-07-01T00:00:00Z" }],
  contact: { name: "Awa Diop", title: "Chargé de compte", isTeam: false, businessEmail: "ops@effitrans.com", businessPhone: null },
});

// ------------------------------------------------------- deterministic engine ----
describe("deterministic customer engine — grounded, cited, customer-safe", () => {
  const cards = buildPortalRecommendations(FULL);
  const kind = (k: string) => cards.find((c) => c.kind === k);

  it("emits only allowlisted CUSTOMER card kinds (no internal-only card exists)", () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(PORTAL_CARD_KINDS).toContain(c.kind);
    // The internal copilot's operator-only kinds must not exist in the customer model.
    for (const internal of ["RISK_SHIPMENT", "COMPLIANCE_WARNING", "BLOCKED_CUSTOMS", "OVERDUE_INVOICE", "CUSTOMER_NOTIFICATION"]) {
      expect(PORTAL_CARD_KINDS as readonly string[]).not.toContain(internal);
    }
  });

  it("no card carries a confidence/score field (customers never see confidence)", () => {
    for (const c of cards) expect(Object.keys(c)).not.toContain("confidence");
    expect(read("../lib/portal/copilot/types.ts")).not.toMatch(/confidence:\s*Confidence/);
  });

  it("shipment progress cites the real file number, route and vessel", () => {
    const c = kind("SHIPMENT_PROGRESS")!;
    expect(c.finding).toContain("EFT-IMP-2099-1");
    expect(c.finding).toContain("Shanghai → Dakar");
    expect(JSON.stringify(c.evidence)).toContain("MSC ISABELLA");
    expect(JSON.stringify(c.evidence)).toContain("MBL-777");
  });

  it("separates documents the CUSTOMER owes from documents under review", () => {
    const missing = kind("MISSING_DOCUMENTS")!;
    const review = kind("DOCUMENT_REVIEW")!;
    expect(missing.finding).toContain("Connaissement");
    expect(missing.finding).not.toContain("Facture commerciale");
    expect(review.finding).toContain("1 document");
    expect(review.suggestedAction).toMatch(/aucune action/i);
    // a validated requirement is neither owed nor under review
    expect(missing.finding).not.toContain("Liste de colisage");
  });

  it("surfaces payable invoices and unread notifications with real references", () => {
    expect(JSON.stringify(kind("INVOICE_AVAILABLE")!.evidence)).toContain("INV-01");
    expect(kind("NOTIFICATION_AVAILABLE")!.finding).toContain("1 information");
  });

  it("customs card states progress only — never a reason, rejection or inspection", () => {
    const c = kind("CUSTOMS_PROCESSING")!;
    expect(c.finding).toContain("Dédouanement en cours");
    expect(JSON.stringify(c)).not.toMatch(/REJECTED|INSPECTION|rejet|blocage|motif/i);
  });

  it("every evidence link stays inside /portal/* (no internal page is ever linked)", () => {
    const links = cards.flatMap((c) => c.evidence.map((e) => e.link)).filter((l): l is string => Boolean(l));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.startsWith("/portal/")).toBe(true);
  });

  it("UPCOMING_ARRIVAL only exists with a REAL dated ETA — never fabricated", () => {
    expect(buildPortalRecommendations(FULL).some((c) => c.kind === "UPCOMING_ARRIVAL")).toBe(true);
    const noEta = buildPortalRecommendations(
      ctx({ shipment: { ...SHIPMENT, eta: { estimatedDate: null, basis: "unknown", delayDays: 0, delivered: false } } }),
    );
    expect(noEta.some((c) => c.kind === "UPCOMING_ARRIVAL")).toBe(false);
  });

  it("a delivered shipment raises no upcoming-arrival card", () => {
    const delivered = buildPortalRecommendations(
      ctx({ shipment: { ...SHIPMENT, eta: { estimatedDate: "2026-07-10T00:00:00Z", basis: "delivered", delayDays: 0, delivered: true } } }),
    );
    expect(delivered.some((c) => c.kind === "UPCOMING_ARRIVAL")).toBe(false);
  });

  it("AWAITING_CUSTOMER_ACTION appears only when the next step is the CLIENT's", () => {
    expect(buildPortalRecommendations(FULL).some((c) => c.kind === "AWAITING_CUSTOMER_ACTION")).toBe(false);
    const owed = buildPortalRecommendations(
      ctx({ shipment: { ...SHIPMENT, nextStep: { title: "Validation des documents", explanation: "…", clientAction: "Veuillez transmettre : Connaissement.", party: "client" } } }),
    );
    expect(owed.find((c) => c.kind === "AWAITING_CUSTOMER_ACTION")!.suggestedAction).toContain("Connaissement");
  });

  it("Missing ≠ Negative: an unconsulted section yields NO card and NO false all-clear", () => {
    const noDocs = buildPortalRecommendations(
      ctx({ shipment: SHIPMENT, sections: ["shipment"], unavailable: ["documents", "invoices"], requirements: [{ label: "Connaissement", state: "requis" }], invoices: [{ invoiceNumber: "X", status: "ISSUED", currency: "XOF", total: 1, balance: 1, dueDate: null, overdue: false, link: "/portal/invoices/x" }] }),
    );
    expect(noDocs.some((c) => c.kind === "MISSING_DOCUMENTS")).toBe(false);
    expect(noDocs.some((c) => c.kind === "INVOICE_AVAILABLE")).toBe(false);
    const summary = portalDeterministicSummary(ctx({ sections: ["shipment"], unavailable: ["documents"] }), []);
    expect(summary).toContain("non incluses");
    expect(summary).toMatch(/information manquante ≠ absence de problème/i);
  });

  it("an empty context yields no cards and never invents a date", () => {
    const empty = ctx({ sections: ["shipment"] });
    expect(buildPortalRecommendations(empty)).toEqual([]);
    const s = portalDeterministicSummary(empty, []);
    expect(s).toMatch(/Aucun point particulier/);
  });

  it("deterministic summary is a real fallback answer (grounded, no date invented)", () => {
    const s = portalDeterministicSummary(FULL, buildPortalRecommendations(FULL));
    expect(s).toContain("EFT-IMP-2099-1");
    expect(s).toContain("2026-07-25");
    expect(s).toContain("Awa Diop");
    const noEta = portalDeterministicSummary(ctx({ shipment: { ...SHIPMENT, eta: { estimatedDate: null, basis: "unknown", delayDays: 0, delivered: false } }, sections: ["shipment"] }), []);
    expect(noEta).toMatch(/pas encore de date confirmée/);
  });
});

// ------------------------------------------------------- customs view ----
describe("customer-safe customs view — derived from the CUSTOMER timeline only", () => {
  const tl = (stages: { key: string; status: string }[]) => ({ timeline: { stages, currentKey: null, nextKey: null, percent: 0 } } as never);
  it("maps cleared / in-progress / not-started without exposing internal status", () => {
    expect(portalCustomsView(tl([{ key: "customs_done", status: "completed" }])).state).toBe("cleared");
    expect(portalCustomsView(tl([{ key: "customs_in_progress", status: "current" }])).state).toBe("in_progress");
    expect(portalCustomsView(tl([{ key: "customs_in_progress", status: "pending" }])).state).toBe("not_started");
  });
  it("never reads customs_record.status (no internal blocking reason can leak)", () => {
    const c = code("../lib/portal/copilot/context.ts") + code("../lib/portal/copilot/view.ts");
    expect(c).not.toMatch(/customs_record|REJECTED|INSPECTION|AWAITING_PAYMENT/);
  });
});

describe("customer-safe map summary — dates a position, never implies it is live", () => {
  const carriage = (over: Record<string, unknown> = {}) =>
    ({
      hasGeo: true,
      map: {
        currentPosition: { label: "Port de Shanghai", occurredAt: "2026-07-15T00:00:00Z", freshness: "STALE", source: "CARRIER_API", confidence: "CONFIRMED", latitude: 1, longitude: 2, kind: "current" },
        milestones: [{}, {}],
      },
      ...over,
    }) as never;

  it("keeps label/date/freshness but DROPS provider source and tracking confidence", () => {
    const m = portalMapSummary(carriage());
    expect(m).toEqual({ hasGeo: true, positionLabel: "Port de Shanghai", positionAt: "2026-07-15T00:00:00Z", positionFreshness: "STALE", milestoneCount: 2 });
    expect(Object.keys(m)).not.toContain("source");
    expect(Object.keys(m)).not.toContain("confidence");
  });
  it("reports no position rather than guessing when geo is absent", () => {
    const m = portalMapSummary(carriage({ hasGeo: false, map: { currentPosition: undefined, milestones: [] } }));
    expect(m.hasGeo).toBe(false);
    expect(m.positionLabel).toBeNull();
    expect(m.positionAt).toBeNull();
  });
});

// ------------------------------------------------------- budget + classifier ----
describe("customer question classifier + budget reuse the SHARED primitives", () => {
  it("classifies the documented customer questions", () => {
    expect(classifyPortalQuestion("Où est mon expédition ?")).toBe("location");
    expect(classifyPortalQuestion("Pourquoi est-elle en retard ?")).toBe("delay");
    expect(classifyPortalQuestion("Quand arrivera-t-elle ?")).toBe("eta");
    expect(classifyPortalQuestion("Quels documents me manquent ?")).toBe("documents");
    expect(classifyPortalQuestion("Quel est le statut de la douane ?")).toBe("customs");
    expect(classifyPortalQuestion("Résume mon expédition.")).toBe("summary");
  });
  it("is deterministic and accent/case-insensitive", () => {
    expect(classifyPortalQuestion("OU EST MON EXPEDITION")).toBe("location");
    expect(classifyPortalQuestion("Où est mon expédition ?")).toBe(classifyPortalQuestion("ou est mon expedition"));
    expect(classifyPortalQuestion("")).toBe("general");
  });
  it("prioritizes the relevant section but NEVER empties another (trimmed, not zeroed)", () => {
    const caps = portalSectionCaps("documents");
    expect(caps.documents).toBe(BUDGET.priorityCap);
    expect(caps.invoices).toBe(BUDGET.minorCap);
    for (const s of PORTAL_SECTIONS) expect(caps[s]).toBeGreaterThan(0);
  });
  it("caps the total brief via the SHARED budget module (not a portal copy)", () => {
    const r = capSerialized("x".repeat(BUDGET.maxSerializedChars + 500));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(BUDGET.maxSerializedChars + 40);
    const b = code("../lib/portal/copilot/budget.ts");
    expect(b).toContain('from "@/lib/copilot/budget"');
    expect(b).not.toMatch(/maxSerializedChars:\s*\d/); // no duplicated cap
  });
  it("the logistics copilot now delegates to the same shared budget (single source)", () => {
    expect(code("../lib/logistics/copilot/budget.ts")).toContain('from "@/lib/copilot/budget"');
  });
});

// ------------------------------------------------------- prompt ----
describe("customer prompt — grounded brief + non-overridable guardrails", () => {
  const brief = serializePortalContext(FULL);
  const sys = buildPortalSystemPrompt();

  it("serializes only safe, real fields the customer already sees", () => {
    expect(brief).toContain("EFT-IMP-2099-1");
    expect(brief).toContain("MSC ISABELLA");
    expect(brief).toContain("INV-01");
    expect(brief).toContain("Awa Diop");
    expect(brief).toContain("Dédouanement en cours");
  });
  it("states unknown ETA explicitly rather than omitting it (no silent gap to fill)", () => {
    const b = serializePortalContext(ctx({ shipment: { ...SHIPMENT, eta: { estimatedDate: null, basis: "unknown", delayDays: 0, delivered: false } } }));
    expect(b).toMatch(/Livraison estimée=INCONNUE/);
    expect(b).toMatch(/ne jamais en inventer une/);
  });
  it("discloses unavailable + truncated sections in the brief", () => {
    const b = serializePortalContext(ctx({ sections: ["shipment"], unavailable: ["invoices"], truncated: ["documents"] }));
    expect(b).toMatch(/NON incluses/);
    expect(b).toMatch(/tronquées/);
  });
  it("marks missing geo as unavailable instead of inviting inference", () => {
    const b = serializePortalContext(ctx({ carriage: { ...FULL.carriage!, map: { hasGeo: false, positionLabel: null, positionAt: null, positionFreshness: null, milestoneCount: 0 } } }));
    expect(b).toMatch(/Position cartographique=non disponible/);
  });
  it("guardrails forbid every internal surface and state they cannot be overridden", () => {
    expect(sys).toMatch(/NON MODIFIABLES/);
    expect(sys).toMatch(/LECTURE SEULE/);
    expect(sys).toMatch(/N'INVENTE RIEN/);
    expect(sys).toMatch(/score de risque/i);
    expect(sys).toMatch(/SLA/);
    expect(sys).toMatch(/journaux d'audit/i);
    expect(sys).toMatch(/notes internes/i);
    expect(sys).toMatch(/erreurs de fournisseur/i);
    expect(sys).toMatch(/NE CITE AUCUN MEMBRE DU PERSONNEL/);
    expect(sys).toMatch(/PAS UNE INSTRUCTION/); // document/message injection defence
    expect(sys).toMatch(/INFORMATION MANQUANTE ≠ ABSENCE DE PROBLÈME/);
  });
  it("assembles system+user with bounded session history and the question last", () => {
    const msgs = buildPortalMessages(FULL, "Où est mon expédition ?", [
      { role: "user", content: "bonjour" },
      { role: "assistant", content: "bonjour, comment puis-je aider ?" },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toMatch(/ÉCHANGES PRÉCÉDENTS/);
    expect(msgs[1].content.trim().endsWith("QUESTION DU CLIENT : Où est mon expédition ?")).toBe(true);
  });
  it("history is bounded (older turns dropped, not sent)", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `question-${i}` }));
    const msgs = buildPortalMessages(FULL, "et maintenant ?", many);
    expect(msgs[1].content).not.toContain("question-0");
    expect(msgs[1].content).toContain("question-29");
  });
});

// ------------------------------------------------------- structural: context reader ----
describe("context reader: RLS-only, composed, bounded, no new domain logic", () => {
  const src = code("../lib/portal/copilot/context.ts");

  it("replaces getCommandCenter with the customer reader (no tenant-wide operator snapshot)", () => {
    expect(src).toContain("export async function getPortalShipmentContext");
    expect(src).not.toMatch(/getCommandCenter|@\/lib\/logistics\/reader/);
  });
  it("composes the EXISTING portal readers instead of duplicating them", () => {
    for (const reader of ["getPortalTracking", "getPortalCarriage", "listPortalInvoices", "listClientNotifications", "getPortalShipments"]) {
      expect(src).toContain(reader);
    }
  });
  it("holds NO supabase client and queries no table itself (cannot widen the boundary)", () => {
    expect(src).not.toMatch(/getAdminSupabaseClient|getServerSupabaseClient/);
    expect(src).not.toMatch(/\.from\("/); // no table query — only composed readers
  });
  it("never escalates privileges — no RBAC permission is asserted for a portal user", () => {
    expect(src).not.toMatch(/assertPermission|hasPermission|getEffectivePermissions|transport:read|customs:read|finance:read/);
    expect(src).toContain("getCurrentPortalUser");
  });
  it("degrades by section and discloses truncation (Missing ≠ Negative)", () => {
    expect(src).toContain("Promise.allSettled");
    expect(src).toContain("unavailable.push");
    expect(src).toContain("truncated.push");
  });
  it("is bounded — hard caps plus the shared question budget", () => {
    expect(src).toContain("portalSectionCaps");
    expect(src).toMatch(/PORTFOLIO_CAP|NOTIFICATION_CAP|ACTIVITY_CAP/);
  });
  it("excludes reviewer free-text notes (internal note + injection surface)", () => {
    expect(src).not.toMatch(/review_note|reviewNote/);
  });
});

// ------------------------------------------------------- structural: route ----
describe("route: portal-only gate, shared engine, safe audit, customer-safe failure", () => {
  const src = code("../app/api/portal/copilot/route.ts");

  it("gates on PORTAL identity only — never on a staff permission", () => {
    expect(src).toContain("getCurrentPortalUser()");
    expect(src).toMatch(/status !== "ACTIVE"/);
    expect(src).toContain('status: 403');
    expect(src).not.toMatch(/assertPermission|logistics:copilot:read|transport:read|customs:read|finance:read/);
  });
  it("reuses the SHARED provider-neutral engine — never lib/ai or a provider directly", () => {
    expect(src).toContain("runCopilotDetailed(");
    expect(src).not.toMatch(/generateAI\(|from "@\/lib\/ai|openai|ollama|vllm|azure/i);
  });
  it("reuses the shared rate limiter with the PORTAL actor column", () => {
    expect(src).toContain("checkPortalCopilotRateLimit(");
    expect(code("../lib/portal/copilot/usage.ts")).toContain('actorColumn: "client_user_id"');
    expect(code("../lib/portal/copilot/usage.ts")).toContain('from "@/lib/copilot/rate-limit"');
  });
  it("always returns deterministic cards (answered, fallback, rate-limited)", () => {
    expect((src.match(/cards,/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("portalDeterministicSummary");
  });
  it("audits SAFE metadata attributed to the PORTAL actor — never prompt/answer/history", () => {
    expect(src).toContain("clientUserId: user.id");
    expect(src).not.toMatch(/actorId:/);
    expect(src).toContain("PORTAL_COPILOT_QUERY");
    expect(src).toContain("durationMs");
    expect(src).toContain("tokens");
    expect(src).toContain("outcome");
    expect(src).not.toMatch(/after:[\s\S]{0,500}(\bprompt\b|\banswer\b|history|fileNumber|clientName)/);
  });
  it("never returns provider diagnostics to the customer (one generic notice)", () => {
    expect(src).not.toContain("copilotErrorMessage");
    expect(src).toContain("FALLBACK_NOTICE");
    // the GET config probe must not expose provider/model/key to a customer
    expect(src).not.toMatch(/provider: config\.provider|apiKeyPresent: config/);
  });
  it("an unowned/unknown dossier is a uniform 404 (no probe, no leak)", () => {
    expect(src).toMatch(/if \(!ctx\) return NextResponse\.json\([\s\S]{0,120}status: 404/);
  });
  it("no provider call unless the customer explicitly asks (GET is config-only)", () => {
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    expect(get).not.toContain("runCopilot");
  });
});

// ------------------------------------------------------- structural: panel ----
describe("panel: session-only, no persistence, no internal surface, ships no secret", () => {
  const src = code("../components/portal/portal-copilot-panel.tsx");

  it("keeps conversation in React state ONLY — no DB, no storage, no cookie", () => {
    expect(src).toContain("useState<Turn[]>([])");
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });
  it("calls only the portal route — never a provider or an internal endpoint", () => {
    expect(src).toContain('fetch("/api/portal/copilot"');
    expect(src).not.toMatch(/api\/logistics|api\/copilot|api\/platform|openai|api_key|apiKey/i);
  });
  it("sends the fileId so the assistant stays scoped to the viewed dossier", () => {
    expect(src).toContain("fileId");
  });
  it("shows no usage/provider/token strip and no confidence badge", () => {
    expect(src).not.toMatch(/usage|token|provider|model|latenc|Confiance/i);
  });
  it("offers a new conversation + export, and renders the fallback notice", () => {
    expect(src).toContain("newConversation");
    expect(src).toContain("exportText");
    expect(src).toContain("res.notice");
  });
  it("is wired into the portal dossier sidebar (placeholder retired)", () => {
    const page = read("../app/portal/(app)/files/[id]/page.tsx");
    expect(page).toContain("<PortalCopilotPanel fileId={tracking.fileId} />");
    expect(page).not.toContain("CopilotSuggestions");
  });
  it("the assistant is renamed and no longer a 'coming soon' placeholder", () => {
    const i18n = read("../lib/i18n.ts");
    expect(i18n).toContain('title: "Assistant Logistique IA"');
    expect(i18n).not.toContain('title: "Assistant Effitrans"');
    expect(i18n).not.toContain('badge: "Bientôt"');
  });
});

// ------------------------------------------------------- no duplicated AI architecture ----
describe("no duplicated AI architecture — one provider chain, untouched", () => {
  it("lib/ai is not imported anywhere in the portal copilot", () => {
    for (const f of ["../lib/portal/copilot/context.ts", "../lib/portal/copilot/cards.ts", "../lib/portal/copilot/prompt.ts", "../lib/portal/copilot/usage.ts", "../app/api/portal/copilot/route.ts"]) {
      expect(code(f)).not.toMatch(/@\/lib\/ai/);
    }
  });
  it("the shared engine still exposes both entry points (runCopilot untouched)", () => {
    const eng = read("../lib/copilot/engine.ts");
    expect(eng).toContain("export async function runCopilotDetailed");
    expect(eng).toContain("export async function runCopilot(messages: CopilotChatMessage[]): Promise<string>");
  });
  it("the portal reuses the shared chat-message contract (no second prompt engine)", () => {
    expect(code("../lib/portal/copilot/prompt.ts")).toContain('from "@/lib/copilot/prompt"');
  });
});
