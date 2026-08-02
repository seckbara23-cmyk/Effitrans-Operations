# EC — Implementation Roadmap & Brief

**Status: BRIEF ONLY.** No EC code, migration, permission or UI exists. Implementation
begins only on explicit approval, phase by phase. Grounding:
[ec-0-architecture-audit.md](ec-0-architecture-audit.md) (ADR-EC-1..7, risks, DEC-EC-D1..D5).

## Phase map

```
EC-1  Inbound foundation (dark)     capture + storage + webhook, no UI
EC-2  Triage workspace              the three governed outcomes
EC-3  COMMERCIAL: Quotation Request the ratified step-1 gap  ← own ratifications
EC-4  Threading & reply             correspondence view on dossier/client
EC-5  AI triage assist              suggestions-only, docintel shapes
EC-6  Activation                    flags, tenant rollout, portal decisions
```

Each phase: dark-first · additive migration(s) ≥ 80 · RLS from birth · BEGIN/ROLLBACK
CI suite appended last · per-step zero-skipped gate before production (DEV-HR6-01
control) · completion report + deployment record.

---

## EC-1 — Inbound foundation (dark)

**Goal:** an email sent to a configured address exists, immutably, in the right tenant.
Nothing else.

* `ec_inbound_message` — append-only (`prevent_mutation`): tenant, provider, provider
  message id (dedup UNIQUE — webhook retries are the payments-webhook lesson), from/to/cc
  (parsed), subject, `message_id`/`in_reply_to`/`references`, received_at, raw MIME
  pointer into new **private `ec-inbound` bucket**, size caps, `status`
  (`RECEIVED → TRIAGED | QUARANTINED | DISCARDED` — a status column, mutation-guarded to
  those transitions only, on the HR-5 decided-request idiom).
* `ec_inbound_attachment` — filename, mime, size, bucket path, sha256. **Not**
  `public.document` (ADR-EC-5).
* Address→tenant routing table (explicit configuration; unmatched → platform quarantine,
  never a guess).
* `app/api/ec/webhook/[provider]/route.ts` on the payments pattern: raw body, signature
  verification in the processor, env-gated (503 dark), internals never leaked.
* RLS: `communication:read` + tenant. No portal policy. No new permission yet.
* Tests: forged-signature refusal · duplicate-delivery idempotency · tenant routing ·
  quarantine path · RLS/SYSTEM-ADMIN-sees-what-`communication:read`-says · immutability.

**Needs before live traffic (not before build):** DEC-EC-D1 (addresses), DEC-EC-D2
(provider + DPA).

## EC-2 — Triage workspace

**Goal:** a human turns each captured message into exactly one governed outcome.

* Outcomes: **attach to dossier** (sets `file_id`; appears on the dossier timeline
  beside outbound rows) · **mark for quotation request** (recorded intent; the entity
  itself is EC-3 — until then the outcome is visible-but-parked, exactly how the B1
  pause worked) · **client correspondence** (`client_id` only) · **discard with
  mandatory reason**.
* `ec_triage_decision` — append-only: message, outcome, actor, reason, created entity
  ref. The decision is the evidence (WES-4 lesson: acts need actors).
* **New permission `communication:triage`** — catalogued, **granted to nobody** until
  DEC-EC-D3 (the consequential-authority precedent). Reads stay `communication:read`.
* Sender→client matching by exact email against client contacts — assistive display
  only, never auto-attach.
* Workspace at `/communications` (extends the existing log page — one canonical route,
  the HR-5A rule). Attention items live-computed (untriaged count, oldest age) — no
  scheduler.
* Ledger: `business_event` emissions (`ec.message_received` at EC-1,
  `ec.message_triaged` here) under the WES-9A mandatory-emission discipline.

## EC-3 — Commercial: Quotation Request (separate context, own ratifications)

**Goal:** close the process-registry step-1 gap. **This is not an EC-internal phase** —
it has its own decision set (DEC-EC-D5) and should open with its own EC-3-0 audit.

* `quotation_request` (from triage or manual) → `quotation` + `quotation_line`
  (versioned, immutable once sent — expense-document idiom) → client approval
  (evidence: actor + date, per the registry's `requiredEvidence`) → **conversion to
  dossier**: creates the `operational_file` and feeds 9.0C intake; the request is the
  dossier's provenance.
* Document types `QUOTATION`, `QUOTATION_APPROVAL`; `client.has_contract` (additive,
  designation audited); permissions `quotation:create/send/approve` exactly as the
  registry names them — catalogued, granted per ratification; approve ≠ create
  (maker-checker CHECK).
* Send goes through `lib/comms`; `quotation_response` SLA policy already exists.
* Registry verdict for step 1 flips `missing → partial/implemented` — with the
  registry's own gap list as the acceptance checklist.

## EC-4 — Threading & reply

* Threading columns on `communication_message` (nullable `message_id`, `in_reply_to`,
  `thread_key`) + same on inbound; thread = correlation view, no new table unless
  proven necessary.
* Reply-from-platform: compose against a thread, `communication:send`, via
  `queueAndSend` — no second engine (ADR-EC-7). Outbound replies carry proper
  `In-Reply-To` headers.
* Dossier and client pages gain a Correspondance panel (read: `communication:read`).

## EC-5 — AI triage assist

* Suggestions-only (ADR-EC-6): suggested outcome + confidence, dossier-reference
  detection (file-number patterns), sender→client fuzzy match, FR/EN language flag.
  Reuses docintel classify shapes and the existing provider seam; body excerpts
  minimal; no attachment binaries in prompts; nothing writes.
* Optional: triage summaries into the operations copilot context (aggregates only).

## EC-6 — Activation

* Two-layer flags per surface; tenant rollout; grant `communication:triage` per
  DEC-EC-D3; portal visibility of correspondence is **its own decision** (default: not
  visible — portal already has Messaging + notifications; adding a third customer
  surface needs a reason).
* Retention enforcement per DEC-EC-D4 — a governed purge mechanism, built only once
  the period is ratified (no legal value invented meanwhile).

---

## Standing constraints (all phases)

Tenant isolation + RLS from birth · portal invisibility until explicitly decided ·
no scoring of clients, no auto-created business entities from unauthenticated input
(ADR-EC-1) · no C3/message bodies in logs, URLs, audit payloads or prompts · additive
forward-only idempotent migrations, never touching 1–79 · fewest permissions,
catalogue-then-grant · no scheduler, no second comms engine, no second document
subsystem, no LMS-style scope creep · PUBLIC repo: secrets env-only · CI green with
per-step zero-skipped before any production application.

## Open decisions recap

**DEC-EC-D1** addresses/domain → blocks EC-1 live · **DEC-EC-D2** provider + DPA →
blocks EC-1 live · **DEC-EC-D3** triage seat → blocks EC-2 activation ·
**DEC-EC-D4** retention → blocks EC-6 · **DEC-EC-D5** quotation vocabulary +
`has_contract` authority → blocks EC-3. Build phases proceed dark ahead of D1–D4;
**EC-3 does not start ahead of D5.**
