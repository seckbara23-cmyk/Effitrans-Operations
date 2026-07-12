import { describe, it, expect } from "vitest";
import { serializeContext, buildSystemPrompt, buildMessages } from "@/lib/copilot/prompt";
import type { CopilotContext } from "@/lib/copilot/context";

function ctx(overrides: Partial<CopilotContext> = {}): CopilotContext {
  const base: CopilotContext = {
    dossier: {
      fileNumber: "IMP-2026-001",
      type: "IMP",
      status: "IN_PROGRESS",
      priority: "high",
      clientName: "ACME SARL",
      openedAt: "2026-06-01",
      createdAt: "2026-05-30",
      transportMode: "SEA",
      incoterm: "CIF",
      origin: "Shanghai",
      destination: "Dakar",
      cargoType: null,
      carrierName: "Maersk",
      vesselOrFlight: null,
      blAwbRef: "BL123",
      containerRef: null,
    },
    lifecycle: {
      completedPercent: 40,
      currentStep: "customs_declaration",
      currentDepartment: "customs",
      nextDepartment: "transport",
      nextAction: { department: "customs", action: "Déclarer en douane", blocker: undefined },
      blockers: [],
      steps: [{ label: "Déclaration douane", department: "customs", status: "current", description: "En cours" }],
      openHandoff: null,
    },
    documents: {
      included: true,
      data: { total: 2, approved: 1, pendingReview: 1, missingRequired: ["Connaissement"], items: [{ type: "Facture", status: "APPROVED", expiry: null, sharedWithClient: true }] },
    },
    customs: {
      included: true,
      data: { present: true, status: "DECLARED", required: true, declarationNumber: "D-99", customsOffice: "Dakar Port", regime: null, baeReference: null, inspectionStatus: null, missingDocuments: [] },
    },
    transport: { included: false },
    finance: { included: false },
    sla: { included: true, data: { status: "warning", department: "customs", stage: "customs_declaration", ageDays: 2, warningHours: 72, criticalHours: 144 } },
    tasks: { included: true, data: { total: 1, open: 1, items: [{ title: "Vérifier BL", status: "TODO", priority: "HIGH", dueAt: "2026-06-20", assignedTo: "a@b.com" }] } },
    tracking: {
      included: true,
      data: {
        present: false,
        driverName: null,
        latestPositionAt: null,
        freshness: "none",
        eta: { estimatedArrival: null, basis: "unavailable", confidence: "low", confidencePercent: 0, delayMinutes: null },
        deliveredAt: null,
        incidents: 0,
        delays: 0,
        events: [],
        omittedEvents: 0,
        customerVisibleCount: 0,
        lastCustomerMessage: null,
      },
    },
    risk: { level: "high", score: 55, reasons: ["Un document requis est manquant."], actions: ["Réclamer ou téléverser les documents requis manquants."] },
  };
  return { ...base, ...overrides };
}

describe("serializeContext", () => {
  it("renders dossier facts", () => {
    const text = serializeContext(ctx());
    expect(text).toContain("IMP-2026-001");
    expect(text).toContain("ACME SARL");
    expect(text).toContain("Shanghai");
    expect(text).toContain("Dakar");
  });

  it("marks sections the user cannot access without inventing data", () => {
    const text = serializeContext(ctx());
    // transport + finance are not included → explicit access boundary.
    const noAccessCount = (text.match(/ACCÈS NON AUTORISÉ/g) ?? []).length;
    expect(noAccessCount).toBe(2);
    expect(text).toContain("=== TRANSPORT ===");
    expect(text).toContain("=== FINANCE ===");
  });

  it("uses a placeholder for empty values rather than fabricating", () => {
    const text = serializeContext(ctx());
    expect(text).toContain("Non renseigné"); // e.g. cargoType / containerRef are null
  });

  it("renders missing-required documents", () => {
    const text = serializeContext(ctx());
    expect(text).toContain("Connaissement");
  });

  it("renders the risk section from the engine output (single source of truth)", () => {
    const text = serializeContext(ctx());
    expect(text).toContain("=== RISQUE");
    expect(text).toContain("HIGH");
    expect(text).toContain("55/100");
    expect(text).toContain("Un document requis est manquant.");
  });

  it("contains no markdown table syntax", () => {
    const text = serializeContext(ctx());
    expect(text).not.toContain("|---");
    expect(text).not.toMatch(/\|.*\|.*\|/);
  });
});

describe("buildSystemPrompt", () => {
  it("encodes the read-only + no-hallucination + plain-text guardrails", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("LECTURE SEULE");
    expect(sys).toContain("N'invente jamais");
    expect(sys).toMatch(/tableaux markdown/i);
    expect(sys).toContain("ACCÈS NON AUTORISÉ");
  });
});

describe("buildMessages", () => {
  it("returns [system, user] with the question and the brief embedded", () => {
    const messages = buildMessages(ctx(), "  Résumer le dossier  ");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("QUESTION DE L'AGENT : Résumer le dossier");
    expect(messages[1].content).toContain("IMP-2026-001");
  });
});

describe("serializeContext — tracking / timeline (AI-2)", () => {
  const withTracking = () =>
    ctx({
      tracking: {
        included: true,
        data: {
          present: true,
          driverName: "Chauffeur Test",
          latestPositionAt: "2026-06-20T10:00:00.000Z",
          freshness: "recent",
          eta: { estimatedArrival: "2026-06-22", basis: "scheduled", confidence: "medium", confidencePercent: 70, delayMinutes: 0 },
          deliveredAt: null,
          incidents: 1,
          delays: 1,
          events: [
            { type: "INCIDENT_REPORTED", occurredAt: "2026-06-20T09:00:00.000Z", kind: "incident", customerVisible: false, customerMessage: null, internalNote: "casse partielle" },
          ],
          omittedEvents: 3,
          customerVisibleCount: 0,
          lastCustomerMessage: null,
        },
      },
    });

  it("renders the SUIVI / CHRONOLOGIE section with driver, ETA and events", () => {
    const text = serializeContext(withTracking());
    expect(text).toContain("=== SUIVI / CHRONOLOGIE ===");
    expect(text).toContain("Chauffeur Test");
    expect(text).toContain("Chronologie");
    expect(text).toContain("INCIDENT");
    expect(text).toContain("plus ancien(s) omis"); // compression is disclosed
  });

  it("marks tracking as ACCÈS NON AUTORISÉ when restricted", () => {
    const text = serializeContext(ctx({ tracking: { included: false } }));
    // transport + finance + tracking are all restricted here.
    const n = (text.match(/ACCÈS NON AUTORISÉ/g) ?? []).length;
    expect(n).toBe(3);
  });
});

describe("buildSystemPrompt — AI-2 grounding + recommendations", () => {
  it("encodes Known/Unknown/Unauthorized grounding, suggested-action and timeline guidance", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("Action suggérée");
    expect(sys).toContain("NON AUTORISÉE");
    expect(sys).toContain("INCONNUE");
    expect(sys).toContain("CHRONOLOGIE");
  });
});

describe("buildMessages — skill routing (AI-2)", () => {
  it("injects the skill fragment as a second system message before the context", () => {
    const messages = buildMessages(ctx(), "Quels documents manquent ?", { skill: "missing_documents" });
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system");
    expect(messages[1].content).toContain("OBJECTIF (Documents manquants)");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toContain("QUESTION DE L'AGENT");
  });

  it("stays a 2-message prompt for the general skill (no fragment)", () => {
    expect(buildMessages(ctx(), "Bonjour", { skill: "general" })).toHaveLength(2);
  });
});

describe("buildMessages — conversation history (D6)", () => {
  it("embeds a compact recap of prior turns before the current question", () => {
    const history = [
      { role: "user" as const, text: "Quels documents manquent ?" },
      { role: "assistant" as const, text: "Il manque le certificat d'origine." },
    ];
    const messages = buildMessages(ctx(), "Et les risques ?", { history });
    const user = messages[messages.length - 1].content;
    expect(user).toContain("HISTORIQUE DE LA CONVERSATION");
    expect(user).toContain("Agent : Quels documents manquent ?");
    expect(user).toContain("Copilote : Il manque le certificat d'origine.");
    // The current question still comes last.
    expect(user).toContain("QUESTION DE L'AGENT : Et les risques ?");
  });
  it("omits the history block when there is none", () => {
    const user = buildMessages(ctx(), "Résume").slice(-1)[0].content;
    expect(user).not.toContain("HISTORIQUE DE LA CONVERSATION");
  });
});
