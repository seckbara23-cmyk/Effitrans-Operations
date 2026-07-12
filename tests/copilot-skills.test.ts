import { describe, it, expect } from "vitest";
import { detectSkill, wantsEnglish, skillPrompt, isCopilotSkill, COPILOT_SKILLS } from "@/lib/copilot/skills";

describe("detectSkill — routes an operational question to a skill", () => {
  const cases: Array<[string, string]> = [
    ["Résume ce dossier en quelques points.", "shipment_summary"],
    ["Où en est le dossier ?", "shipment_summary"],
    ["Quels documents requis manquent ?", "missing_documents"],
    ["Il manque la liste de colisage ?", "missing_documents"],
    ["Où en est le dédouanement ?", "customs_status"],
    ["La mainlevée (BAE) est-elle obtenue ?", "customs_status"],
    ["Pourquoi ce dossier est-il en retard ?", "delay_analysis"],
    ["Où est le camion en ce moment ?", "tracking_status"],
    ["Quelle est l'ETA de la livraison ?", "tracking_status"],
    ["Quel est le niveau de risque ?", "risk_summary"],
    ["Quelle est la prochaine étape opérationnelle ?", "next_step"],
    ["Rédige une mise à jour pour le client.", "client_update"],
    ["Rédige une note de passation interne.", "internal_handover"],
    ["Que s'est-il passé hier sur ce dossier ?", "timeline_summary"],
    ["Qu'est-ce qui a changé aujourd'hui ?", "timeline_summary"],
  ];
  for (const [q, expected] of cases) {
    it(`"${q}" → ${expected}`, () => {
      expect(detectSkill(q)).toBe(expected);
    });
  }

  it("falls back to general for an unrelated / empty question", () => {
    expect(detectSkill("Bonjour, comment ça va ?")).toBe("general");
    expect(detectSkill("")).toBe("general");
    expect(detectSkill("   ")).toBe("general");
  });

  it("prioritises the generation intent when a client message is requested", () => {
    // Mentions both "retard" (delay) and "client" + "mise à jour ... client" — client_update wins.
    expect(detectSkill("Rédige une mise à jour client expliquant le retard.")).toBe("client_update");
  });
});

describe("wantsEnglish — client-message language hint", () => {
  it("detects an English request", () => {
    expect(wantsEnglish("Rédige une mise à jour client in English")).toBe(true);
    expect(wantsEnglish("Peux-tu écrire ce message en anglais ?")).toBe(true);
  });
  it("defaults to false (French)", () => {
    expect(wantsEnglish("Rédige une mise à jour client")).toBe(false);
  });
});

describe("skillPrompt — focused fragment per skill", () => {
  it("returns a non-empty French fragment for every user-selectable skill", () => {
    for (const s of COPILOT_SKILLS) {
      const p = skillPrompt(s);
      expect(p.length).toBeGreaterThan(0);
      expect(p).toContain("OBJECTIF");
    }
  });
  it("returns an empty fragment for general (base prompt only)", () => {
    expect(skillPrompt("general")).toBe("");
  });
  it("switches the client-update message language on request", () => {
    expect(skillPrompt("client_update", { english: true })).toMatch(/ANGLAIS/);
    expect(skillPrompt("client_update", { english: false })).toMatch(/FRANÇAIS/);
  });
  it("next_step marks recommendations as suggestions, never executed", () => {
    expect(skillPrompt("next_step")).toContain("Action suggérée");
  });
});

describe("isCopilotSkill", () => {
  it("validates known skills incl. general, rejects unknown", () => {
    expect(isCopilotSkill("customs_status")).toBe(true);
    expect(isCopilotSkill("general")).toBe(true);
    expect(isCopilotSkill("delete_dossier")).toBe(false);
    expect(isCopilotSkill("")).toBe(false);
  });
});
