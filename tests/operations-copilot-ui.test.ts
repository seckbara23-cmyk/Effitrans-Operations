/**
 * Phase 10.0F-2 — Operations Copilot UI. The client panel + cockpit wiring are verified
 * STRUCTURALLY: shown only to holders of the existing gate, suggestions render, loading/
 * response/error/fallback states, SAFE plain-text rendering (no model HTML), no business
 * reader / no mutation / no persistence in the component, POSTs only the question.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = code("../components/operations/operations-copilot-panel.tsx");
const SECTIONS = code("../components/operations/cockpit-sections.tsx");

describe("placement + permission gate", () => {
  it("the panel appears only for the EXISTING operational-AI permission holders", () => {
    expect(SECTIONS).toContain('hasPermission(perms, "logistics:copilot:read")');
    expect(SECTIONS).toContain("canCopilot && <OperationsCopilotPanel />");
    expect(SECTIONS).not.toMatch(/operations:copilot|copilot:operations/); // no new permission
  });
  it("is placed below the alert panel (immediate attention region)", () => {
    expect(SECTIONS.indexOf("CockpitAttentionPanel")).toBeLessThan(SECTIONS.indexOf("OperationsCopilotPanel"));
  });
  it("is a client island (loads interactively, does not block SSR)", () => {
    expect(read("../components/operations/operations-copilot-panel.tsx")).toContain('"use client"');
  });
});

describe("panel behavior — suggestions, states, safe rendering", () => {
  it("has the title and the six suggested questions", () => {
    expect(PANEL).toContain("Copilote des opérations");
    for (const q of [
      "Que faut-il traiter en priorité aujourd'hui ?",
      "Résumez les opérations du jour.",
      "Quels dossiers nécessitent une intervention ?",
      "Quels blocages financiers affectent les opérations ?",
      "Quels problèmes douaniers nécessitent une action ?",
      "Quelles livraisons sont en retard ?",
    ]) {
      expect(PANEL, q).toContain(q);
    }
  });
  it("renders loading, error and answer states + a fallback indicator", () => {
    expect(PANEL).toContain("pending");
    expect(PANEL).toContain('role="status"'); // loading
    expect(PANEL).toContain('role="alert"'); // error
    expect(PANEL).toContain("answer.usedFallback"); // deterministic-fallback indicator
    expect(PANEL).toContain("Réponse déterministe");
  });
  it("renders the answer as SAFE PLAIN TEXT — never model-generated HTML", () => {
    expect(PANEL).toContain("whitespace-pre-wrap");
    expect(PANEL).not.toContain("dangerouslySetInnerHTML");
    expect(PANEL).not.toMatch(/<iframe|<script|<img/);
  });
  it("submits ONLY the question — never tenant/context/provider/model", () => {
    expect(PANEL).toContain("JSON.stringify({ question:");
    for (const injected of ["tenantId", "context", "provider:", "model:", "systemPrompt", "permissions"]) {
      expect(PANEL, injected).not.toContain(injected);
    }
    expect(PANEL).toContain('fetch("/api/operations/copilot"');
  });
});

describe("doctrine — the component owns nothing", () => {
  it("calls NO business reader and NO supabase client", () => {
    expect(PANEL).not.toContain("getAdminSupabaseClient");
    expect(PANEL).not.toMatch(/\.from\(/);
    for (const reader of ["getOperations", "getControlTower", "getCommandCenter", "runOperationsCopilot", "buildOperationsContext"]) {
      expect(PANEL, reader).not.toContain(reader);
    }
  });
  it("performs no mutation, no persistence, no Realtime/polling (session-only state)", () => {
    expect(PANEL).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(PANEL).not.toContain("localStorage");
    expect(PANEL).not.toMatch(/\.channel\(|\.subscribe\(|setInterval/);
    expect(PANEL).not.toContain("revalidatePath");
  });
});
