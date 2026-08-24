# Control-level authorization audit — dossier workspaces

**2026-08-24. Read-only. Nothing implemented, nothing mutated by me.**
Requested after the Dédouanement workspace exposed controls belonging to several
different actors on one page.

---

## 1. ⚠ Correction first: Démarrer did NOT activate step 4

The operator reported « Démarrer succeeded ». **Production says otherwise.**

| Fact (read live) | Value |
| --- | --- |
| `coordinator_reception` state | **AVAILABLE** (unchanged) |
| `assigned_user_id` | **null** |
| `started_at` | **null** |
| audit `PROCESS_STEP_ACTIVATED` | **absent** |

`activateStep` sets `state='ACTIVE'`, `started_at`, `assigned_user_id = caller`
and `assigned_role_code`, then writes `PROCESS_STEP_ACTIVATED`. **None of that
happened**, so the activation did not succeed. What the operator observed was
arriving at the Dédouanement workspace — navigation, not activation.

**A-1 is therefore NOT yet confirmed in production.** It is CI-proven and
deployed, but the one production observation offered as proof does not
demonstrate it. This needs a clean re-test before anyone counts it.

## 2. ⚠ 00007 WAS mutated during that session — by the workspace, not by me

Audit trail since reception contains exactly two events:

```
process.handoff.received   2026-08-23 19:01:38
customs.created            2026-08-24 12:08:31   ← by chef.transit.demo
```

A `customs_record` now exists on 00007 (`status NOT_STARTED`, `required true`,
`created_by = chef.transit.demo`). **Creating the customs dossier is official
step 6 `customs_preparation`, owned by the DÉCLARANT** — and step 6 is not the
current step; step 4 is, and it is still open.

So the Chef de Transit performed a Déclarant act, on a dossier whose workflow had
not reached that step. **This is not hypothetical exposure: it executed.**
It also silently satisfied the customs-department visibility clause, which is why
`can_read` would now be true by two independent grounds.

I have not repaired this and will not without instruction. Note that it does
change 00007's value as clean regression evidence for anything downstream of
customs creation.

## 3. Root cause: controls are PERMISSION-derived, never STEP-derived

Mechanical proof — occurrences of any step/state concept in the control layer:

| File | `stepKey` / `officialStep` / `process_step_execution` / `EFFITRANS_PROCESS` |
| --- | --- |
| `components/customs/customs-panel.tsx` | **0** |
| `lib/customs/actions.ts` | **0** |
| `components/finance/finance-panel.tsx` | **0** |
| `lib/finance/actions.ts` | **0** |

Every control is gated exactly once, on a permission:

```tsx
canCreate={hasPermission(permissions, "customs:create")}
canValidate={hasPermission(permissions, "customs:validate")}
canRegisterGainde={hasPermission(permissions, "customs:register")}
…
canCreate={hasPermission(permissions, "finance:create")}
canIssueInvoice={hasPermission(permissions, "finance:issue")}
```

…and each server action re-checks **the same permission and nothing else**
(`assertPermission("customs:create")` etc.). There is no notion of "is this the
current step" or "is this actor the step's owner" anywhere in either layer.

**Consequence:** any dossier a user can READ exposes every control their
permissions allow, at any point in the lifecycle. F-1 deliberately widened who
can read a dossier — which makes this pre-existing gap materially more reachable.
The two interact, and that is the "next class of defect" to close.

## 4. Control matrix — Dédouanement workspace, as Chef de Transit

`CHIEF_OF_TRANSIT` holds: `customs:assign, create, read, release, update,
validate` · `process:handoff:receive/send`, `process:read`,
`process:blocker:manage`, `process:decision:create`, `process:team:manage`.

| Control | Business actor (registry) | Required permission | Owning step / expected state | Visible to CdT? | Executable by CdT? | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Required-document status | read-only | `customs:read` | — | yes | n/a (display) | OK |
| **Créer le dossier douane** | **Déclarant** | `customs:create` | **6 `customs_preparation`** | **yes** | **YES — and it did** | **DEFECT** |
| Champs déclaration + **Enregistrer** | Déclarant | `customs:update` | 6 / 11 | yes | yes | **DEFECT** |
| **Recevabilité** (UI says « Déclarant en douane ») | Déclarant | `customs:update` | 6 (QC3) | yes | yes | **DEFECT** |
| **GAINDE/ORBUS attachment** (UI says Déclarant) | Déclarant | `customs:update` | 11 `gainde_document_submission` | yes | yes | **DEFECT** |
| **Enregistrement GAINDE** | **Finance douane** | `customs:register` | 9 `gainde_registration` | **no** (lacks perm) | no | OK — by luck of permission, not by step |
| **Validation Chef de Transit** | Chef de Transit | `customs:validate` | **7 `transit_validation`** | yes | yes — **but step 7 is not open** | **DEFECT (premature)** |
| Transit quality-control section | Chef de Transit | `customs:read`/`validate` | 7 | yes | mixed | as above |
| BAE / release | Agent terrain douane | `customs:release` | 13 `customs_field_clearance` | yes | yes | **DEFECT** |
| Supprimer le dossier douane | admin | `customs:delete` | — | no | no | OK |

**Answer to the direct question:** the Chef de Transit is **not** intentionally
authorised to perform Déclarant actions *at this point in the workflow*. Their
permission set is broad — plausibly deliberate so a chief can cover their team —
but the platform draws no line between *may do in principle* and *is the actor
for this step now*. Every DEFECT row above is a control belonging to a different
actor **or to a future step**, offered and executable today.

## 5. Same pattern on the Finance screens

| Control | Actor | Permission | Owning step | Gated on step? |
| --- | --- | --- | --- | --- |
| Créer facture / brouillon | BILLING_OFFICER | `finance:create` | 20 `billing_draft` | **no** |
| Modifier | BILLING_OFFICER | `finance:update` | 20 | **no** |
| Émettre (simple path) | BILLING_OFFICER | `finance:issue` | 22 `billing_dispatch` | **no** |
| Encaisser / paiement | FINANCE/COLLECTIONS | `finance:payment` | 26 | **no** |

The governed billing lane (`lib/process/billing/actions.ts`) is the exception —
it **does** consult the process: `billingReady()` evaluates the gate, and
`canValidateInvoice` enforces maker≠checker on identity. That is the correct
pattern and it already exists in the codebase. The per-dossier Finance panel does
not use it, which is precisely how the simple `/finance` issue path stays
reachable and produces the deposit-ineligible invoice recorded earlier.

## 6. What a fix would have to be (NOT proposed for implementation yet)

The shape that matches the platform's own precedent (`billingReady`,
`evaluateBillingGate`, `evaluateMakerChecker`) is a **step-aware capability
resolver**: a control is offered and accepted when the caller holds the
permission **AND** the dossier's official step that owns that control is open —
with an explicit, ratified list of acts a supervisory role may perform out of
sequence, if Effitrans wants one.

Two decisions belong to Effitrans before any code:

1. **May a Chef de Transit perform Déclarant acts at all?** If yes, under what
   conditions (covering an absent declarant? only after assignment? never before
   the step opens?). Today the answer is an accident of permission breadth.
2. **Should out-of-sequence acts be blocked, or warned-and-audited?** Blocking is
   safer; warning preserves the flexibility a small operator may actually need.

I am not proposing an implementation until those are answered, because every
plausible fix encodes one of those answers.

## 7. Impact on Tuesday

* This is a **third instance of one pattern**: a surface deriving authority from
  something other than current workflow responsibility — first visibility (F-1),
  then step execution (A-1/A-2), now per-dossier controls.
* It does **not** block the governed journey: the billing lane is step-aware, and
  the customs chain functions. It means the rehearsal can be **driven off the
  rails by a well-meaning click**, which is what happened to 00007.
* **Verdict remains RED**, and this is now on the list with F-2 and the journey
  proof.

**Diagnosis only. No code changed. No production mutation by me.**
