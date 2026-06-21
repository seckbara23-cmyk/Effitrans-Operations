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
