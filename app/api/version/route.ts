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
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? null,
    hosted: process.env.VERCEL === "1",
  });
}
