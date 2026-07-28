/**
 * The canonical workflow input — a BRAND, not a convenience. PURE.
 * ---------------------------------------------------------------------------
 * `getDossierLifecycle` and `buildCanonicalProjection` used to accept any object
 * literal of the right shape. That is how a permission-gated assembly reached
 * the workflow calculation and produced a different operational truth per
 * viewer: a Finance user without `customs:read` passed `customs: null`, the
 * projection read that as "customs not started", and the dossier reported
 * « Préparation douane » while it was delivered, invoiced and paid.
 *
 * Shape was never the problem. `{ customs: null }` is perfectly well-typed and
 * completely wrong. What the type system could not express was PROVENANCE:
 * whether the values came from complete reads or from whatever this viewer
 * happened to be allowed to see.
 *
 * So the input is branded. The brand is unforgeable outside this module, and
 * the only way to obtain one is `canonicalWorkflowInput(...)`, whose contract is
 * stated in one line and enforced by review and by test:
 *
 *     EVERY field must come from a read that was NOT gated by the viewer's
 *     permissions.
 *
 * A caller that wants to hand the projection a partial view now has to write
 * that intent down explicitly, and a test scans for it. Making the mistake
 * requires deciding to make it.
 */
import type { LifecycleInput } from "@/lib/files/lifecycle";

declare const CANONICAL_BRAND: unique symbol;

/**
 * A `LifecycleInput` that is guaranteed to have been assembled from complete,
 * ungated reads. Only `canonicalWorkflowInput` can produce one.
 */
export type CanonicalWorkflowInput = LifecycleInput & {
  readonly [CANONICAL_BRAND]: "canonical";
};

/**
 * Mint a canonical workflow input.
 *
 * CONTRACT — the caller asserts, and a reviewer must be able to verify at the
 * call site, that every field was read WITHOUT consulting the viewer's
 * permissions. Concretely: no `canRead*` ternary, no `hasPermission(...) ? x : null`,
 * no `access.customs ? ... : []` may appear between the query and this call.
 *
 * Bulk surfaces (control tower, department queues, portfolio views) legitimately
 * mint many of these from one batched query — the invariant is ungated reads,
 * not a single call site.
 */
export function canonicalWorkflowInput(input: LifecycleInput): CanonicalWorkflowInput {
  return input as CanonicalWorkflowInput;
}
