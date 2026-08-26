# C-4 — residual findings

Items surfaced by the C-4 acceptance program that are **not** C-4 defects and are
deliberately not solved inside it. Each is recorded so it is neither lost nor
allowed to expand the acceptance boundary.

Classification C per the C-4 stop rule: architectural improvement, theoretical
exposure, business ambiguity, or workflow enhancement outside the C-4 boundary.

---

## R-1 — explicit send/receive at cross-department transitions

**Status:** deferred to workflow / UAT validation. Not a C-4 blocker.

Twenty-one of the twenty-six steps cross a department boundary. Four of them
have a sender in the product today:

| from | to |
|---|---|
| `am_dossier_opening` | `coordinator_reception` |
| `gainde_registration` | `coordinator_to_declarant` |
| `billing_dispatch` | `administration_deposit_prep` |
| `administration_proof_handoff` | `collections` |

The other seventeen are reached by prerequisite promotion alone, with the
operator's generic « Envoyer » action available but not required.

The ratified reception rule (Option 1) blocks execution only where a handoff
**already exists** and is still `SENT`. It creates no handoffs and imposes
reception on none of the seventeen. So the platform is consistent with itself,
and the open question is a business one:

> Should every cross-department transition require an explicit send and receive,
> or is prerequisite promotion a sufficient invitation where the departments
> already work from a shared dossier?

Answering it means deciding, per transition, whether an operator must press
« Recevoir » before starting work that is already visibly theirs. That is a
question about how Effitrans wants to work, not about whether the engine is
correct, and it belongs to UAT with the people who would press the button.

**Not to be resolved by making the engine stricter to look tidier.**

---

## R-2 — invoice numbering gaps from failed issuance

**Status:** open business ruling. Recorded during C-4 Section F.

A failed send burns a sequence value: the number is allocated before the mail
attempt, so an SMTP failure leaves a gap in the issued-invoice sequence.

Whether this is defective depends on the accounting requirement. Senegalese
practice on sequential invoice numbering, and whether Sage 100 tolerates gaps on
import, decide it. Until ruled it is neither a defect nor accepted.

---

## R-3 — closure leaves a non-terminal process instance on the manual door

**Status:** RATIFIED AS CORRECT — frozen, do not re-open.

`operational_file.status = CLOSED` reached through `transitionFile` (the CEO's
"step 27", a `file:transition` act) does not itself close the process instance;
`closeDossier` does both. The two-door architecture is deliberate and the ruling
froze it. Recorded here only so the asymmetry is not rediscovered and re-argued
as a defect.

---

## R-4 — `courier:deposit` is not held by any actor who can verify a proof

**Status:** correct by design, recorded for UAT awareness.

Step 24 completes only after Administration verifies the proof, and only the
courier may complete it. This is the ratified Option B separation. Operationally
it means a courier must return to the queue after verification to close the
step. The courier queue exposes `submit`, so the action is offered; whether the
round trip is workable in practice is a UAT observation, not a code question.
