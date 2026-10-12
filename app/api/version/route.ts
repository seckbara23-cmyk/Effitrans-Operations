/**
 * Build-info endpoint (Phase 8.0B — gate C1). PUBLIC, read-only, secret-free.
 * ---------------------------------------------------------------------------
 * The canonical mechanism for the release-gate rule "after every deployment, verify the
 * Production SHA is the intended one" (rollback-plan.md §Verify, gate-closure.md §C1).
 * Returns ONLY what Vercel already exposes to every build: the git SHA/ref and the
 * deployment environment. No configuration, no provider names, no env values, no secrets —
 * safe on a public URL (the SHA identifies a commit; it grants nothing).
 *
 * Off-Vercel (local `next start`, CI) the fields are null and `hosted` is false — the
 * verification script treats that as "cannot attest" rather than a failure.
 *
 * EFF-STAGING-ISOLATION-02 adds `db`: WHICH database this deployment is bound to,
 * as a hint plus a hash prefix plus the guard's verdict — never a key, a URL, a
 * host or a full project ref. EFF-PR33-PREVIEW-DATA-ISOLATION-01 could not
 * establish whether a Preview shared the production database because previews are
 * sealed and the binding was invisible from outside. This makes that question one
 * unauthenticated request, for any deployment, forever.
 */
import { NextResponse } from "next/server";
import { bindingReport } from "@/lib/env/binding-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? null,
    hosted: process.env.VERCEL === "1",
    db: bindingReport(),
  });
}
