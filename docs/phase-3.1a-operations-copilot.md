# Phase 3.1A — Operations Copilot (read-only AI assistant)

A read-only AI Copilot embedded in the dossier page (`/files/[id]`). It answers
operational questions about a single dossier from a tenant- and permission-scoped
snapshot of existing records. It performs **no writes, no SQL, no task creation,
no email, no workflow changes** — it only produces plain text.

## Architecture

| Concern | Implementation |
| --- | --- |
| Context (single source of truth) | `lib/copilot/context.ts` — reuses `getFile`, documents/customs/transport/finance/tasks services, the pure `getDossierLifecycle` tracker, `getDossierStage` (SLA) and `getOpenHandoffForFile`. |
| Prompt building | `lib/copilot/prompt.ts` — pure serializer + system/user message builders. |
| Model call | `lib/copilot/openai.ts` — OpenAI Chat Completions (`gpt-5.5`), plain text, no tools/function-calling. |
| API | `app/api/copilot/route.ts` — `POST /api/copilot` `{ fileId, prompt }` → `{ text }`. |
| UI | `components/copilot/copilot-panel.tsx` — right-side drawer on the dossier page. |

### Security model (inherited, not re-implemented)
- **Auth**: route requires an authenticated user (`getCurrentUser` → 401).
- **Permission**: `file:read` is enforced (→ 403) — the same gate as the page.
- **Tenant isolation / visibility**: `getFile` is RLS/visibility-scoped, so a
  dossier the caller cannot access resolves to `null` → **404**. The AI never
  sees it.
- **Per-feature visibility**: each embedded section (documents, customs,
  transport, finance, tasks) is gated by the SAME `*:read` permission as the
  page. A section the caller cannot read is marked `included: false` and carries
  no data; the prompt tells the model explicitly it has no access there.
- **No data fabrication**: empty fields render as “Non renseigné”; the model is
  instructed to answer only from the brief and to say when something is unknown.

## Configuration

| Env var | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | — | Server-only secret. Without it the route returns 503. |
| `OPENAI_COPILOT_MODEL` | No | `gpt-5.5` | Override the model id. |

## Live test checklist

Run against a seeded environment with `OPENAI_API_KEY` set.

### Functional
- [ ] Open `/files/[id]`; the “Copilote” launcher appears bottom-right.
- [ ] Click it; the right-side drawer opens with the intro + suggested prompts.
- [ ] “Résumer le dossier” returns a coherent plain-text summary (no markdown table).
- [ ] “Qu'est-ce qui manque ?” lists the dossier’s missing required documents (matches the Documents panel).
- [ ] “Quelle est la prochaine étape ?” matches the Lifecycle tracker’s next action.
- [ ] “Risques détectés” surfaces SLA warnings / overdue invoices / blockers actually present.
- [ ] “Rédiger une mise à jour client” produces a copy-ready message grounded only in dossier facts.
- [ ] “Rédiger une note de passation interne” reflects the current department / open handoff.
- [ ] Free-text question works; Enter sends, Shift+Enter newlines.

### Read-only / no side effects
- [ ] After several prompts, the dossier, tasks, documents, customs, transport and finance are **unchanged**.
- [ ] No new audit entries, tasks, emails, or communications are created.
- [ ] Network tab shows only `POST /api/copilot` (no mutation endpoints).

### Security
- [ ] A user **without** `file:read` gets 403 (no panel data).
- [ ] A user from another tenant requesting a foreign `fileId` gets **404** (no leakage).
- [ ] A user **without** `finance:read` asks about invoices → Copilot says it has no access to finance (does not invent figures).
- [ ] Same for `customs:read`, `transport:read`, `document:read`, `task:read`.

### Resilience
- [ ] With `OPENAI_API_KEY` unset → friendly “non configuré” message (HTTP 503).
- [ ] Simulated upstream failure → friendly “service indisponible” message (HTTP 502); no raw upstream body shown.
- [ ] Empty / whitespace prompt is rejected (HTTP 400); no model call made.

### Hallucination guardrails
- [ ] Ask for a value that is genuinely absent (e.g. a BAE reference not yet issued) → Copilot states it is not available rather than inventing one.
- [ ] Responses contain no markdown tables.

## Automated coverage
- `tests/copilot-context.test.ts` — pure `assembleCopilotContext` packaging + permission gating (no data leaked when a section is not accessible).
- `tests/copilot-prompt.test.ts` — serializer facts, access-boundary markers, no markdown tables, system-prompt guardrails, message assembly.
- `npm run typecheck` and the full `vitest` suite remain green.
