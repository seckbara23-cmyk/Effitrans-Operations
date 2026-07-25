/**
 * Phase 10.0F-2 — Operations Copilot API. The route pulls the server auth chain, so it is
 * verified STRUCTURALLY (the house idiom): existing-permission gate, question-only input,
 * client cannot control tenant/context/provider/model/prompt, one runner call, deterministic
 * fallback surfaced safely, redacted response + audit, French errors, no DB/business read,
 * no mutation/tools, no new permission.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTE = code("../app/api/operations/copilot/route.ts");

describe("route — authorization on the EXISTING permission (no new permission)", () => {
  it("GET and POST both assert logistics:copilot:read and 403 on PermissionError", () => {
    expect(ROUTE).toContain('assertPermission("logistics:copilot:read")');
    expect(ROUTE).toContain("PermissionError");
    expect(ROUTE).toContain("status: 403");
    expect(ROUTE).not.toMatch(/operations:copilot|copilot:operations|alerts?:read/); // no new permission
  });
  it("is server-only (force-dynamic + nodejs runtime)", () => {
    expect(ROUTE).toContain('export const dynamic = "force-dynamic"');
    expect(ROUTE).toContain('export const runtime = "nodejs"');
  });
});

describe("input validation — question only; the server owns identity and context", () => {
  it("reads ONLY body.question — never tenant/user/context/provider/model/prompt from the client", () => {
    expect(ROUTE).toContain("body?.question");
    for (const injected of ["body?.tenantId", "body?.userId", "body?.context", "body?.provider", "body?.model", "body?.systemPrompt", "body?.permissions"]) {
      expect(ROUTE, injected).not.toContain(injected);
    }
  });
  it("rejects an empty question and an oversized question with French 400s", () => {
    expect(ROUTE).toContain("La question est requise.");
    expect(ROUTE).toContain("MAX_QUESTION");
    expect(ROUTE).toContain("La question est trop longue");
    expect(ROUTE).toMatch(/status: 400/);
  });
});

describe("abuse control — bounded rate limit over the audit log (no new table)", () => {
  it("uses checkAuditRateLimit keyed on the operations action + per-user/per-tenant, 429 on limit", () => {
    expect(ROUTE).toContain("checkAuditRateLimit");
    expect(ROUTE).toContain("AuditActions.OPERATIONS_COPILOT_QUERY");
    expect(ROUTE).toContain("perActorPerMin");
    expect(ROUTE).toContain("perTenantPerDay");
    expect(ROUTE).toContain("status: 429");
  });
});

describe("runner — called exactly once via the existing seam; fallback surfaced safely", () => {
  it("calls runOperationsCopilot exactly once and never re-implements context/prompt/provider", () => {
    expect((ROUTE.match(/runOperationsCopilot\(/g) ?? [])).toHaveLength(1);
    for (const dup of ["buildOperationsContext", "buildOperationsMessages", "runCopilotDetailed", "generateAI"]) {
      expect(ROUTE, dup).not.toContain(dup);
    }
  });
  it("returns usedFallback from the runner result (deterministic degradation, not an error)", () => {
    expect(ROUTE).toContain("usedFallback: result.fallback");
  });
});

describe("response + audit redaction", () => {
  it("returns only a safe shape: answer + generatedAt + provider + usedFallback", () => {
    expect(ROUTE).toContain("answer: result.text");
    expect(ROUTE).toContain("generatedAt: result.generatedAt");
    expect(ROUTE).toContain("usedFallback: result.fallback");
    // No raw context / prompt / kpi / alert objects in the response.
    for (const leak of ["kpis:", "alerts:", "context:", "prompt", "messages"]) {
      expect(ROUTE, leak).not.toContain(leak);
    }
  });
  it("audits SAFE metadata only — never the question, answer or context", () => {
    expect(ROUTE).toContain("writeAudit");
    expect(ROUTE).toContain("AuditActions.OPERATIONS_COPILOT_QUERY");
    // Scope the redaction check to the audit call (between writeAudit and the response).
    const auditBlock = ROUTE.slice(ROUTE.indexOf("await writeAudit"), ROUTE.indexOf("answer: result.text"));
    for (const secret of ["question", "result.text", "context", "raw"]) {
      expect(auditBlock, secret).not.toContain(secret);
    }
    expect(auditBlock).toContain("focus: result.focus"); // safe classification
    expect(auditBlock).toContain("outcome:");
    // The answer text crosses only into the RESPONSE, exactly once.
    expect((ROUTE.match(/result\.text/g) ?? [])).toHaveLength(1);
  });
  it("the audit action constant exists", () => {
    expect(AuditActions.OPERATIONS_COPILOT_QUERY).toBe("operations.copilot.query");
  });
});

describe("error + fallback — controlled French, no secrets", () => {
  it("an unexpected failure is reported and returns a generic French 500, never a raw exception", () => {
    expect(ROUTE).toContain("reportError");
    expect(ROUTE).toContain("Le copilote des opérations n'a pas pu répondre");
    expect(ROUTE).toContain("status: 500");
    expect(ROUTE).not.toMatch(/err\.message|err\.stack|String\(err\)/); // no raw exception surfaced
  });
});

describe("doctrine — no direct DB, no business read, no mutation, no tools", () => {
  it("no supabase client / business table read from the route itself", () => {
    expect(ROUTE).not.toContain("getAdminSupabaseClient");
    expect(ROUTE).not.toMatch(/\.from\(/);
    for (const reader of ["getOperationsCockpit", "getOperationsKpis", "getOperationalAlerts", "getControlTower", "getFinanceQueue"]) {
      expect(ROUTE, reader).not.toContain(reader);
    }
  });
  it("no business mutation, no AI tools/function-calling, no Realtime/polling", () => {
    expect(ROUTE).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(ROUTE).not.toMatch(/tools:|function_call|tool_call|\.channel\(|setInterval/);
  });
});
