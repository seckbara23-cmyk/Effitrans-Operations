/**
 * Workflow policy content hashing (Phase WES-7). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * A deterministic sha256 over the NORMALIZED policy document, used for integrity
 * verification, version comparison, duplicate detection and audit.
 *
 * REUSE: the canonicalization discipline is the one ratified in 11.0B for
 * immutable finance versions (`lib/finance/expense/hash.ts`) — keys sorted
 * recursively so key ORDER can never change the digest. Building a second
 * hashing convention would be exactly the drift this programme exists to end.
 *
 * NORMALIZATION goes one step further than canonicalization: policy arrays are
 * SETS of bindings, not ordered lists, so they are sorted by their natural key
 * before hashing. Two documents that differ only in the order an operator
 * happened to add rules are the same policy and must hash identically —
 * otherwise duplicate detection would never fire.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "@/lib/finance/expense/hash";
import type { WorkflowPolicyDocument } from "./schema";

/** Sort key for each domain — the fields that identify a binding. */
const SORT_KEY: Record<string, (row: Record<string, unknown>) => string> = {
  applicability: (r) => String(r.stepKey),
  departments: (r) => String(r.stepKey),
  seats: (r) => `${String(r.stepKey)}|${String(r.seat)}`,
  evidence: (r) => String(r.stepKey),
  handoffs: (r) => `${String(r.fromStepKey)}|${String(r.toStepKey)}`,
  supervisors: (r) => String(r.department),
  sla: (r) => String(r.policyKey),
};

/**
 * Order-independent, whitespace-independent form of the document. Also sorts the
 * string arrays INSIDE a binding (roles, document codes) for the same reason.
 */
export function normalizePolicyDocument(doc: WorkflowPolicyDocument): WorkflowPolicyDocument {
  const out = { ...doc } as unknown as Record<string, unknown>;

  for (const [domain, keyOf] of Object.entries(SORT_KEY)) {
    const rows = out[domain];
    if (!Array.isArray(rows)) continue;
    out[domain] = [...rows]
      .map((row) => sortInnerArrays(row as Record<string, unknown>))
      .sort((a, b) => keyOf(a as Record<string, unknown>).localeCompare(keyOf(b as Record<string, unknown>)));
  }
  return out as unknown as WorkflowPolicyDocument;
}

/** Sort the string arrays a binding carries (roles, codes, facts, keys). */
function sortInnerArrays(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(copy)) {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      copy[k] = [...(v as string[])].sort();
    }
  }
  return copy;
}

/**
 * The version's content digest. Computed over the normalized document only —
 * NEVER over storage metadata (id, status, timestamps, actor), so the hash
 * identifies the POLICY, not the row that happens to carry it.
 */
export function policyContentSha256(doc: WorkflowPolicyDocument): string {
  return createHash("sha256").update(canonicalize(normalizePolicyDocument(doc)), "utf8").digest("hex");
}

/** Two documents express the same policy. Used for duplicate detection. */
export function policiesAreIdentical(a: WorkflowPolicyDocument, b: WorkflowPolicyDocument): boolean {
  return policyContentSha256(a) === policyContentSha256(b);
}

export type PolicyDiffEntry = { domain: string; key: string; change: "added" | "removed" | "changed" };

/**
 * A structural diff between two versions — what the comparison screen renders.
 * Deliberately domain-level, not a text diff: an operator needs to see *which
 * binding* changed, not which characters did.
 */
export function diffPolicies(a: WorkflowPolicyDocument, b: WorkflowPolicyDocument): PolicyDiffEntry[] {
  const out: PolicyDiffEntry[] = [];
  const left = normalizePolicyDocument(a) as unknown as Record<string, unknown>;
  const right = normalizePolicyDocument(b) as unknown as Record<string, unknown>;

  for (const [domain, keyOf] of Object.entries(SORT_KEY)) {
    const index = (rows: unknown) =>
      new Map(
        (Array.isArray(rows) ? rows : []).map((r) => [
          keyOf(r as Record<string, unknown>),
          canonicalize(r),
        ]),
      );
    const l = index(left[domain]);
    const r = index(right[domain]);

    for (const [key, value] of l) {
      if (!r.has(key)) out.push({ domain, key, change: "removed" });
      else if (r.get(key) !== value) out.push({ domain, key, change: "changed" });
    }
    for (const key of r.keys()) {
      if (!l.has(key)) out.push({ domain, key, change: "added" });
    }
  }
  return out;
}
