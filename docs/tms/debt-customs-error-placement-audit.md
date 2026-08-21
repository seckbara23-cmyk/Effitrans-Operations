# Customs-panel error placement — AUDIT

**AUDIT ONLY. Nothing implemented.** TMS-7 (`71c7004`), RQ-18b (`5cab533`),
issue-date/determinism (`fdc5f38`) and deposit canonicalization (`d8a57b0`) stay
CLOSED. Phase 1.8 fossil cleanup, deposit-proof verifier-seat governance and
`UNIQUE (file_id)` multi-leg modelling are untouched.

---

## 0. Headline: the error is not merely far away — it is attached to the WRONG control

`components/customs/customs-panel.tsx` (473 lines) holds **one** `error` state shared
by **nine** action call sites, and renders it in **one** place in the main panel:
**line 445, the very bottom**, immediately below the metadata form's « Enregistrer »
button.

So the placement is correct for exactly **one** of the nine actions — the metadata
save — and for the other eight the message appears *adjacent to an unrelated
control*. A refusal from « → Déclaré » renders where it reads as "saving the
metadata failed".

That is why UAT-15 Part 3 Step 1 felt like a silent failure: the refusal
« Documents requis manquants pour déclarer. » was correct, rendered, and 245 JSX
lines below the button that produced it.

---

## 1. Affected actions and where each error originates

All nine route through the same `run()` helper and the same `t.customs.errors` map.

| # | Action | Server origin | Button line | Error rendered | Distance |
| --- | --- | --- | --- | --- | --- |
| 1 | `createCustoms` | `lib/customs/actions.ts` | 119 | **127** | ✅ adjacent (`!record` branch) |
| 2 | `releaseCustoms` | " | 186 | 445 | ~259 lines |
| 3 | `changeCustomsStatus` | " (`customs_docs_missing`, `invalid_transition`, `use_release`) | 200 | 445 | ~245 lines |
| 4 | `deleteCustoms` | " | 210 | 445 | ~235 |
| 5 | `recordGaindeRegistration` | " | 248 | 445 | ~197 |
| 6 | `recordCustomsAttachment` | " | 289 | 445 | ~156 |
| 7 | `recordCustomsValidation` | " | 322 | 445 | ~123 |
| 8 | `recordReceivability` | " | 369 / 372 | 445 | ~73 |
| 9 | `updateCustoms` (metadata form) | " | 438 | 445 | ✅ adjacent |

Five titled sections sit between the workflow buttons and the message: GAINDE (220),
Rattachement (259), Validation (301), Recevabilité (332), Métadonnées (385).

---

## 2. Why it lands there

Nothing is "wrong" in a defect sense — the panel simply grew. `run()` was written
when the panel had one section, and every phase since (MAYA-P1.1, P1.11, P0.8-A,
P0.7-A) appended a new section **above** the single trailing render. The message did
not move; the panel grew past it.

```ts
const [error, setError] = useState<string | null>(null);

function run(fn: () => Promise<ActionResult>) {
  setError(null);                                   // cleared on every start
  startTransition(async () => {
    const res = await fn();
    if (!res.ok) { setError(map[res.error] ?? c.errors.generic); return; }
    router.refresh();
  });
}
```

---

## 3. Presentation only, or a deeper workflow problem? **Presentation only.**

The server side is sound and was proven so during TMS-7:

* refusals are correct — UAT-15 Part 3 confirmed `customs_docs_missing` was the
  ratified document gate firing, with **no** row written and **no** audit entry;
* every refusal code has an explicit French message in `t.customs.errors`;
* the state machine, the CAS and the permission checks are untouched by this debt.

**No authorization, transition or governance change is implied.** This is where a
correct message is drawn.

One aggravating overlap worth noting: the panel already renders a « documents
manquants » banner at line 170, *directly above* the workflow buttons. So when a
declaration is refused for missing documents, the CONTEXT is beside the button and
the EXPLANATION is 275 lines below it.

---

## 4. Can errors from different actions overwrite or share state? **Yes — one state, no attribution.**

| Behaviour | Verdict |
| --- | --- |
| Stale error persisting across actions | **No.** `setError(null)` runs at the start of every `run()`, before the await |
| Two actions showing errors at once | **Impossible** — a single string |
| The message identifying WHICH action failed | **No.** Nothing records the origin, so the reader must infer it from position — and the position points at the wrong control |
| A slow action's error landing after the user moved on | **Possible.** `startTransition` is not cancelled; if action A is in flight and the user starts B, B clears the error, then A's rejection sets it — attributed by position to neither |

The last row is a real, if narrow, race. It is not observed in production and the
consequence is a misleading message, not a wrong write.

---

## 5. Successful actions clear previous errors? **Yes.**

`setError(null)` fires at the top of `run()`, so beginning any action clears the
previous message, and a success then calls `router.refresh()`. No stale error
survives a successful action. **This half is already correct and must stay correct.**

---

## 6. Accessibility — the more serious half

| Requirement | Present? |
| --- | --- |
| `aria-live` / `role="alert"` on the error | **NO** — grep across `components/customs/` returns nothing |
| `aria-describedby` associating the error with its control | **NO** |
| Focus moved to, or near, the error | **NO** |
| Error adjacent in DOM order to its trigger | **NO** for 8 of 9 actions |

For a sighted user the message exists but is far away and mis-attributed. **For a
screen-reader or keyboard user it is effectively silent**: nothing announces it, and
nothing connects it to the control just activated. That is a worse failure than the
visual one and is the strongest argument for fixing this.

---

## 7. Affected surfaces

**One.** `components/customs/customs-panel.tsx`, rendered from `app/files/[id]/page.tsx`.
No customs surface exists on the Transit department pages, the process page or the
portal. The `!record` branch (line 127) is already correct and needs no change.

---

## 8. Smallest architecture-consistent correction

**Attribute the error to its action, and render it where that action lives.**

### Recommended

1. Widen the state from `string | null` to `{ scope: string; message: string } | null`.
2. `run(fn, scope)` — one extra argument at each of the nine call sites; the scope
   names the section (`"workflow" | "gainde" | "attachment" | "validation" |
   "receivability" | "metadata" | "create"`).
3. Render a small `<ErrorLine scope="…" />` inside each section, showing the message
   only when `error?.scope` matches. **The single trailing render at 445 becomes the
   `metadata` scope**, which is where it already belongs.
4. Give the element `role="alert"` so assistive technology announces it — this is the
   accessibility fix and it is one attribute.

* No server change, no i18n change, no new error codes, no authority change.
* `setError(null)`-on-start is preserved exactly, so §5 stays true.
* Scope typed as a union so a typo cannot silently hide a message.

### Considered and rejected

| Option | Why not |
| --- | --- |
| Move the single render above the workflow buttons | Fixes action 3 and breaks the metadata form, which is currently the only correct one. Trades one mis-attribution for another |
| Duplicate the same `{error && …}` in every section | The same message would appear up to six times at once |
| A toast / global notification | A second notification system for one panel; the platform has no toast idiom, and it would lose the association with the control |
| Per-action `useState` (nine states) | Nine states to clear consistently; the scope discriminator gets the same result with one |

---

## 9. Regression and mutation coverage required

**Regression**

1. Each of the nine actions renders its message **inside its own section**.
2. A workflow refusal does **not** render next to the metadata save button.
3. Starting any action clears a previous error (§5 must not regress).
4. A success leaves no error behind.
5. Two sections never display a message simultaneously.
6. The error element carries `role="alert"`.
7. The `!record` create branch still shows its error adjacent (unchanged).
8. Every `t.customs.errors` code still maps to a French message — the mapping is
   untouched.

**Mutation**

* the scope argument dropped at a call site (message silently disappears → must FAIL);
* two sections rendering the same scope (duplicate display);
* `setError(null)` removed from `run()` (stale errors return);
* `role="alert"` removed;
* the scope comparison inverted (`!==`), showing messages everywhere but the right place;
* a refusal falling through to `c.errors.generic` when a specific code exists.

⚠ **Bound every pin to its own section slice.** This session hit the
satisfied-by-neighbouring-text trap three times — most recently on a guard line
shared by `acceptProof`/`rejectProof`. Nine near-identical `{error && …}` blocks in
one file is precisely that shape, so a whole-file `toContain` will prove nothing.

---

## Decision requested

> **Approve the scoped-error correction** — `{ scope, message }`, one `<ErrorLine>`
> per section, `role="alert"`, no server or i18n change?
>
> Or prefer a narrower first cut: **`role="alert"` plus moving the workflow refusal
> only**, leaving the other sections for later?

*(Noted for planning, not started: the next major workstream is the ICTD / ICAM /
IPAM Formula-Parity Audit against the Effitrans methodology and workbooks.)*
