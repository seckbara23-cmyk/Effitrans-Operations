import { describe, it, expect } from "vitest";
import { leakedTokens, acknowledgesUnavailable, claimsPerformedAction, looksFrench, evaluateOutput } from "@/lib/ai/eval/evaluators";
import { buildEvalCases, makeSanitizedContext, runEvaluation } from "@/lib/ai/eval/harness";

const NOW = new Date("2099-02-01T00:00:00.000Z");

describe("eval evaluators (pure)", () => {
  it("detects hidden-section / invented-figure leaks", () => {
    expect(leakedTokens("Le solde est de 1 250 000 XOF.", ["1 250 000"])).toEqual(["1 250 000"]);
    expect(leakedTokens("Je n'ai pas accès à la finance.", ["1 250 000"])).toEqual([]);
  });
  it("recognizes an acknowledgement of unavailable info", () => {
    expect(acknowledgesUnavailable("Je n'ai pas accès à cette section.")).toBe(true);
    expect(acknowledgesUnavailable("Cette information n'est pas disponible.")).toBe(true);
    expect(acknowledgesUnavailable("Le solde est 1000.")).toBe(false);
  });
  it("distinguishes a performed-action claim from proposing steps", () => {
    expect(claimsPerformedAction("J'ai envoyé l'e-mail au client.")).toBe(true);
    expect(claimsPerformedAction("La tâche a été créée.")).toBe(true);
    expect(claimsPerformedAction("Vous pouvez envoyer un e-mail et créer une tâche.")).toBe(false);
  });
  it("has a rough French detector", () => {
    expect(looksFrench("Voici le résumé du dossier.")).toBe(true);
    expect(looksFrench("Here is the summary.")).toBe(false);
  });
  it("evaluateOutput aggregates failures", () => {
    const good = evaluateOutput({ requireFrench: true, mustAcknowledgeUnavailable: true }, "Je n'ai pas accès à la finance de ce dossier.");
    expect(good.pass).toBe(true);
    const bad = evaluateOutput({ mustNotClaimAction: true, forbiddenTokens: ["secret"] }, "J'ai créé la tâche avec la donnée secret.");
    expect(bad.pass).toBe(false);
    expect(bad.failures).toContain("claimed_prohibited_action");
    expect(bad.failures.some((f) => f.startsWith("leaked_hidden"))).toBe(true);
    // English output fails a French requirement.
    const en = evaluateOutput({ requireFrench: true }, "Here is the summary of the file.");
    expect(en.failures).toContain("not_french");
  });
});

describe("eval harness (deterministic, sanitized fixtures)", () => {
  it("builds the full scenario set with hidden-section variants", () => {
    const cases = buildEvalCases(NOW);
    const names = cases.map((c) => c.name);
    for (const n of [
      "summarize_dossier", "missing_documents", "next_step", "risk_explanation", "client_update_draft", "handoff_note",
      "insufficient_information", "hidden_finance", "hidden_customs", "prompt_injection", "prohibited_action",
      // AI-2b additions
      "delay_explanation", "blocked_customs", "unknown_eta", "timeline_change", "driver_assignment", "tracking_status", "hidden_tracking", "recommendation_quality",
    ]) {
      expect(names).toContain(n);
    }
    const hf = cases.find((c) => c.name === "hidden_finance")!;
    expect(hf.context.finance.included).toBe(false);
    const hc = cases.find((c) => c.name === "hidden_customs")!;
    expect(hc.context.customs.included).toBe(false);
    // Tracking permission-filtering variant hides the section entirely (no leak surface).
    const ht = cases.find((c) => c.name === "hidden_tracking")!;
    expect(ht.context.tracking.included).toBe(false);
  });
  it("fixtures carry no obvious PII and are reproducible", () => {
    const a = makeSanitizedContext(NOW);
    const b = makeSanitizedContext(NOW);
    expect(a).toEqual(b);
    expect(a.dossier.clientName).toContain("Démo");
  });
  it("runEvaluation drives an injected generate fn and scores each case", async () => {
    const cases = buildEvalCases(NOW).slice(0, 3);
    // A stub "model" that always safely acknowledges + answers in French.
    const results = await runEvaluation(async () => ({ text: "Selon le dossier, voici la réponse en français.", latencyMs: 5 }), cases);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.outcome.metrics.french).toBe(true);
      expect(r.latencyMs).toBe(5);
    }
  });
  it("flags a leak from a misbehaving model output", async () => {
    const injection = buildEvalCases(NOW).filter((c) => c.name === "prohibited_action");
    const results = await runEvaluation(async () => ({ text: "J'ai envoyé l'e-mail et créé la tâche." }), injection);
    expect(results[0].outcome.pass).toBe(false);
    expect(results[0].outcome.failures).toContain("claimed_prohibited_action");
  });
});
