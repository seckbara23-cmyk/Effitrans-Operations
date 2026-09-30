/**
 * STEP22-PORTAL-DELIVERY-01 — the Client Space is the delivery channel, and
 * email is an optional notification.
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
 *
 * STEP22-ISSUANCE-INTEGRITY-01 refused issuance outright when no mail provider
 * was configured. That was right while email WAS the delivery mechanism. It is
 * wrong now: the customer already has a Client Space, and withholding an invoice
 * they could already read — because Effitrans has not finished its DNS and
 * provider setup — punishes the customer for an internal configuration gap.
 *
 * NOTHING WAS BUILT TO PUBLISH ANYTHING. Production already derives Client Space
 * visibility from the genuine issuance fact:
 *
 *     invoice_portal_select:  portal_can_read_file(file_id)
 *                             AND status IN ('ISSUED','PARTIALLY_PAID','PAID')
 *
 * So the ISSUED compare-and-set IS the delivery. An invoice cannot be
 * issued-but-unavailable, and a VALIDATED one stays invisible because the
 * database says so rather than because this code remembered to hide it. That
 * boundary is proven against a REAL database by
 * `supabase/tests/rls_portal_invoice_test.sql`, which this slice extended with
 * the VALIDATED case — the one status it predated.
 *
 * REMOVING THE GUARD IS SAFE ONLY BECAUSE OF THE ORDER. It existed to stop an
 * official number being burned by a send that could never succeed. The number is
 * now persisted WITH the ISSUED status before anything is attempted, so a failed
 * or impossible send costs nothing. Restoring the guard without restoring the old
 * ordering would be the numbering defect again — asserted below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isIssuedStatus } from "@/lib/finance/status";
import { BILLING_ERROR_FR } from "@/lib/process/billing/state";
import { domainFactSatisfied, DOMAIN_OWNED_STEPS } from "@/lib/process/domain-owned-steps";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BILLING = "lib/process/billing/actions.ts";
const STATE = "lib/process/billing/state.ts";
const PDF_ROUTE = "app/api/invoices/[id]/pdf/route.ts";
const PORTAL_READER = "lib/portal/docs-service.ts";
const RLS_TEST = "supabase/tests/rls_portal_invoice_test.sql";

// ==================================== issuance no longer waits on email ========

describe("issuance is not gated on an email provider", () => {
  it("the provider precondition is gone from the governed action", () => {
    const src = code(BILLING);
    expect(src).not.toContain("isProviderConfigured");
    expect(src).not.toContain("delivery_not_configured");
  });

  it("…and its vocabulary went with it — dead words hide live gaps", () => {
    expect(code(STATE)).not.toContain("delivery_not_configured");
    expect((BILLING_ERROR_FR as Record<string, string>).delivery_not_configured).toBeUndefined();
  });

  /**
   * The ordering is what makes the removal safe, so it is pinned here as well as
   * in the integrity suite: a reviewer who reintroduces the guard should see why
   * the order came first.
   */
  it("the number is still persisted WITH the ISSUED status, before any send", () => {
    const src = code(BILLING);
    const e = src.slice(src.indexOf("export async function emailValidatedInvoice"));
    const numbered = e.indexOf("next_invoice_number");
    const issued = e.indexOf('status: "ISSUED"');
    const artifact = e.indexOf("ensureOfficialInvoiceArtifact");
    const sent = e.indexOf("const sent = await queueAndSend(");
    const step = e.indexOf('submitStep(fileId, "billing_dispatch")');
    expect(numbered).toBeGreaterThan(0);
    expect(issued, "ISSUED + number are one write, after allocation").toBeGreaterThan(numbered);
    expect(artifact, "the official document follows issuance").toBeGreaterThan(issued);
    expect(sent, "the send is attempted last, and can cost nothing").toBeGreaterThan(artifact);
    expect(step).toBeGreaterThan(sent);
  });

  it("the ISSUED write is still fenced, so no retry can re-issue or renumber", () => {
    const src = code(BILLING);
    const e = src.slice(src.indexOf("export async function emailValidatedInvoice"));
    expect(e).toContain('.eq("status", "VALIDATED")');
    expect(e).toContain('.is("invoice_number", null)');
    expect(e).toContain("let invoiceNumber = loaded.invoiceNumber;");
    expect((src.match(/next_invoice_number/g) ?? []).length, "one allocation site").toBe(1);
  });
});

// ======================================== delivery is derived, not published ====

describe("Client Space visibility is derived from the issuance fact", () => {
  it("no publication operation, table, column, flag or event was introduced", () => {
    const src = code(BILLING);
    for (const invented of [
      "publishInvoice", "publish_invoice", "portal_published", "published_at",
      "portalPublished", "makeAvailable", "shared_with_client",
    ]) {
      expect(src, invented).not.toContain(invented);
    }
    // …and no second RLS policy or schema change rode along.
    expect(src).not.toMatch(/\b(create policy|alter table|create table|add column)\b/i);
  });

  it("the portal reader stays a USER-CONTEXT client, so RLS is the boundary", () => {
    const src = read(PORTAL_READER);
    expect(src).toContain("getServerSupabaseClient");
    expect(src, "an admin client here would bypass the portal policies").not.toContain(
      "getAdminSupabaseClient",
    );
    // It applies no client filter of its own — the policy does that.
    expect(code(PORTAL_READER)).not.toMatch(/\.eq\("client_id"/);
  });

  it("ISSUED is exactly the set the portal policy admits", () => {
    // The policy is `status IN ('ISSUED','PARTIALLY_PAID','PAID')`; the
    // application predicate must not drift from it, or "issued" and "visible"
    // would stop being the same instant.
    for (const s of ["ISSUED", "PARTIALLY_PAID", "PAID"]) expect(isIssuedStatus(s), s).toBe(true);
    for (const s of ["DRAFT", "VALIDATED", "VOID"]) expect(isIssuedStatus(s), s).toBe(false);
  });

  it("the real-database RLS suite proves VALIDATED stays invisible", () => {
    const sql = read(RLS_TEST);
    expect(sql).toContain("'VALIDATED'");
    expect(sql).toContain("portal_validated_not_visible");
    // The probe must actually RUN, not merely be named: deleting the select left
    // p_validated NULL, and `null <> 0` is null — a vacuous guard that passes.
    expect(sql).toContain("select count(*) into p_validated from public.invoice");
    expect(sql).toContain("coalesce(p_validated, -1)<>0");
  });
});

// ============================================ the official PDF's own door ======

describe("the official PDF is reachable only by the right client", () => {
  const src = code(PDF_ROUTE);

  it("requires a session, and scopes the lookup to the tenant", () => {
    expect(src).toContain('{ error: "unauthenticated" }');
    expect(src).toMatch(/\.eq\("tenant_id", tenantId\)/);
  });

  it("a portal user may read ONLY their own client's invoice", () => {
    expect(src).toContain("invoice.client_id !== portal.clientId");
    // Answered as not-found, so the route never confirms another client's id.
    expect(src).toMatch(/invoice\.client_id !== portal\.clientId[\s\S]{0,120}not_found/);
  });

  it("cross-tenant is impossible by construction, not by a second check", () => {
    // `portal_can_read_file` joins client_user to the file and requires BOTH
    // cu.client_id = f.client_id AND cu.tenant_id = f.tenant_id, so a portal
    // session cannot reach another tenant's dossier at all.
    const fn = read("supabase/migrations/20260615000005_create_portal.sql");
    expect(fn).toContain("cu.tenant_id = f.tenant_id");
    expect(fn).toContain("cu.status = 'ACTIVE'");
  });

  it("an unissued invoice has no official document", () => {
    expect(src).toContain('invoice.status === "DRAFT" || !invoice.invoice_number');
    expect(src).toContain('{ error: "not_issued" }');
  });

  it("bytes are streamed from the private bucket — no signed URL to share", () => {
    expect(src).toContain(".download(artifact.storagePath)");
    expect(src).not.toContain("createSignedUrl");
  });
});

// ================================== email stays optional and stays truthful ====

describe("email semantics after portal delivery", () => {
  const src = code(BILLING);
  const e = src.slice(src.indexOf("export async function emailValidatedInvoice"));

  it("invoice.emailed is written ONLY when a message was accepted", () => {
    expect(e).toContain('if (sent.status === "SENT") {');
    const guard = e.indexOf('if (sent.status === "SENT") {');
    const emailed = e.indexOf("AuditActions.INVOICE_EMAILED");
    expect(emailed).toBeGreaterThan(guard);
  });

  it("a failure is recorded as retryable, and never reverses issuance", () => {
    expect(e).toContain("AuditActions.INVOICE_EMAIL_FAILED");
    expect(e).toContain("retryable: true");
    expect(e).toContain("invoice_issued: true");
    expect(e, "the failure branch must not return").not.toContain('return fail("email_send_failed")');
  });

  it("the outbound row is always written, so it stays retryable later", () => {
    // An unconfigured provider still produces a durable FAILED row, which
    // `comm_acquire_send` re-acquires once mail is configured. Nothing is
    // fabricated and the notification is not silently dropped.
    expect(e).toContain("const sent = await queueAndSend(");
    const acquire = read("supabase/migrations/20260811000001_outbound_mail.sql");
    expect(acquire).toContain("and status in ('QUEUED', 'FAILED')");
  });
});

// ============================================ PR #21 invariants still hold =====

describe("nothing from the issuance-integrity slice was weakened", () => {
  it("step 22 stays domain-owned, and its fact still needs status AND number", () => {
    expect(DOMAIN_OWNED_STEPS.billing_dispatch.withdraws).toEqual(["submit"]);
    const f = (over: Record<string, unknown> = {}) => ({
      status: "VALIDATED", submittedAt: "t", validatedAt: "t",
      rejectionReason: null, invoiceNumber: null, ...over,
    }) as Parameters<typeof domainFactSatisfied>[2][number];

    expect(domainFactSatisfied("billing_dispatch", "submit", [f()])).toBe(false);
    expect(domainFactSatisfied("billing_dispatch", "submit", [f({ status: "ISSUED" })])).toBe(false);
    expect(domainFactSatisfied("billing_dispatch", "submit", [f({ invoiceNumber: "n" })])).toBe(false);
    expect(
      domainFactSatisfied("billing_dispatch", "submit", [f({ status: "ISSUED", invoiceNumber: "n" })]),
    ).toBe(true);
  });

  it("FINAL_INVOICE still cannot represent an unissued invoice", () => {
    const ev = code("lib/process/engine/evidence.ts");
    expect(ev).toContain("snap.invoices.some((i) => isIssuedStatus(i.status))");
    expect(ev).not.toMatch(/status !== "DRAFT" && .*status !== "VOID"/);
  });

  it("the artifact is still produced only after the ISSUED write", () => {
    const issued = e_index('status: "ISSUED"');
    const artifact = e_index("ensureOfficialInvoiceArtifact");
    expect(artifact).toBeGreaterThan(issued);
  });
});

function e_index(needle: string): number {
  const src = code(BILLING);
  return src.slice(src.indexOf("export async function emailValidatedInvoice")).indexOf(needle);
}
