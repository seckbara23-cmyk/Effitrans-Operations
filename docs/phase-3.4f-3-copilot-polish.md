# Phase 3.4F-3 — AI Production Polish (Final)

UX + production polish for the Operational Copilot. **No new AI capabilities** — the
model stays read-only; this phase makes the assistant easier to use, diagnose, and
operate. All export/streaming/cache work is **dependency-free** and reuses existing code.

## What shipped

**D1 Provider-aware errors** — `lib/copilot/provider-ux.ts` `copilotErrorMessage(code,
{provider, model})` (pure). Ollama down → "L'assistant IA local n'est pas disponible.
Vérifiez qu'Ollama est en cours d'exécution."; missing model → "Le modèle IA « qwen2.5:3b »
n'est pas installé." + `ollama pull …`; local timeout hints the model may be starting; the
rate-limit wording is shown **only for `AI_PROVIDER=openai`**. The route resolves the
provider/model (secret-free) and returns the specific message.

**D2 Loading state** — the panel shows "🤖 Analyse du dossier…" with rotating sub-steps
(Lecture des documents… / Analyse de la chronologie… / Recherche des risques…) and animated
bouncing dots, instead of a blank wait.

**D3 Provider badge** — the footer shows the resolved provider from the GET diagnostic:
"Qwen2.5 3B • Local" / "OpenAI • Cloud" / "vLLM • Enterprise" (`providerDisplay`). Makes
support trivial.

**D4 Collapsible metadata** — the transparency footer (sources used · restrictions d'accès ·
informations indisponibles · confiance) is a `<details>` collapsed by default.

**D5 Streaming (progressive reveal)** — the answer is revealed token-by-token client-side
(typewriter) so even a slow local model feels responsive. Chosen over server SSE to keep
retry/fallback and the deterministic transparency meta intact.

**D6 Conversation history** — the panel sends the last few turns; `buildMessages` embeds a
compact "HISTORIQUE DE LA CONVERSATION" recap before the current question (bounded to 6 turns
× 400 chars). Context (the dossier brief) is **not** rebuilt — the AI-2a 15 s memo already
caches it.

**D7 Repeat-question cache** — the same question within ~30 s on the same dossier returns the
cached answer + meta instantly, no model call (client-side, per-dossier).

**D8 Better empty state** — before the first question: "Bonjour 👋 · Je peux vous aider à :"
with a capability list.

**D9 Copy** — each answer has a 📋 Copier button (clipboard) with a "Copié" confirmation.

**D10 Export** — `lib/copilot/export.ts` (pure, dependency-free): **PDF** via the native
`lib/reports/pdf` writer, **Word** as RTF (opens/edits in Word), **Email** as a `.eml`
draft (RFC 822, `X-Unsent: 1`). The panel builds a Blob and downloads it client-side.

## Reuse / no new dependencies
- Errors reuse the existing `CopilotError` codes + `getCopilotConfig` (secret-free).
- Provider badge reuses the existing GET `/api/copilot` diagnostic.
- PDF export reuses the dependency-free `PdfDoc` writer from `lib/reports/pdf`.
- Word (RTF) + Email (.eml) are plain strings — no `docx`/`jspdf`/mail library added.
- Streaming/cache/history are client-side or a small prompt addition — no provider or schema
  change; read-only contract unchanged.

## Security
No secrets ever leave the server (provider/model tags are already non-sensitive; the key is
never returned). Provider-aware messages are built from `getCopilotConfig` (booleans + names
only). Permission gating, tenant isolation, and the transparency boundary are unchanged from
AI-2. History is client-supplied and bounded; the server still rebuilds context under the
same permission fingerprint.

## Tests / validation
- `tests/copilot-provider-ux.test.ts` — provider-aware messages (Ollama down / missing model
  + pull hint / local timeout / OpenAI-only rate limit / OpenAI key / generic fallback),
  `prettyModel`, `providerDisplay`.
- `tests/copilot-export.test.ts` — `wrapText` (wrap + preserve newlines), valid PDF bytes
  (`%PDF`…`%%EOF`), RTF (accents escaped, `\par`), `.eml` (unsent, UTF-8, RFC 2047 subject,
  CRLF body), `exportFilename`.
- `tests/copilot-prompt.test.ts` — conversation-history recap embedded / omitted.
- `npm run typecheck` / `npm test` (647 passed) / `npm run build` all green.

## Notes for a pilot
- Raise `OLLAMA_NUM_PREDICT` (eval showed 6/23 verbose answers hit the 512-token cap).
- The provider badge + provider-aware errors make "why is the Copilot down?" self-diagnosable
  (Ollama not running vs model missing vs cold start).
