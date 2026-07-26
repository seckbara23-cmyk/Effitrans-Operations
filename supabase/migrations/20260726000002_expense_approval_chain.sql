-- 20260726000002_expense_approval_chain.sql
-- Effitrans Operations Platform — PHASE 11.0D: Autorisation approval chain.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Activates the visa chain 11.0B built the ledger for and 11.0C left
-- unsigned. NO table is created, altered or dropped; NO policy is changed; NO
-- permission is invented. Two things happen:
--
--   1. A UNIQUE INDEX that makes a double-signed step structurally impossible.
--   2. The signer-map GRANTS that 11.0B deliberately withheld ("finance:expense:
--      sign is granted to NO role in 11.0B — the visa signer-map is 11.0C/D").
--
-- THE CHAIN IS THE RATIFIED ONE (DEC-C08 / AUTHORIZATION_VISA_STEPS), i.e. the
-- order PRINTED on the paper form and in the seven visa boxes of the 11.0C PDF:
--   1 Demandeur      -> the document's REQUESTER (identity, not a role)
--   2 Chef de Transit-> CHIEF_OF_TRANSIT
--   3 Coordonnateur  -> COORDINATOR
--   4 Operation      -> UNBOUND (BLK-FIN-2) — the chain HALTS here, honestly
--   5 Tresoriere     -> TREASURER
--   6 DAF            -> DAF
--   7 DG             -> CEO
--
-- The signer map itself is CODE (lib/finance/expense/visa.ts), per the platform's
-- registry idiom; this migration only grants the capability those seats need.

-- ===========================================================================
-- 1. One visa per step per attempt — the concurrency backstop.
--
--    11.0A §6 specifies CAS on (document, version, step_ordinal) and §18 keeps
--    DB constraints as the backstop. The ledger is APPEND-ONLY, so a duplicate
--    written by two simultaneous signers could never be deleted afterwards — the
--    guarantee therefore has to live in the schema, not only in the action.
--
--    Keyed on ATTEMPT (not version): an attempt is exactly one approval round on
--    one version, so this forbids signing a step twice within a round while
--    still allowing a fresh attempt to re-collect visas after a RETURNED
--    correction (the engine's correction-as-new-attempt precedent). attempt_id
--    is NOT NULL for every row, so this covers the Bon's chain in 11.0E too.
-- ===========================================================================
create unique index uq_expense_visa_attempt_step
  on public.expense_visa (attempt_id, step_ordinal);

-- ===========================================================================
-- 2. Signer grants (DEC-C11). LEAST PRIVILEGE — only the seats that actually
--    sign THIS chain, and only the capabilities they need to do it:
--
--    * finance:expense:sign — the six signing seats. The Demandeur step is
--      identity-bound (the requester), and requesters hold finance:expense:
--      create, which FINANCE_OFFICER already has; it gains sign for that step.
--    * finance:expense:read — CHIEF_OF_TRANSIT, COORDINATOR and CEO are NOT in
--      the 11.0B read grant, so without this they could not even see the
--      document they are asked to sign.
--
--    DELIBERATELY NOT GRANTED:
--    * CASHIER — execution-only, holds no authorization (DEC-C21, ratified).
--    * SYSTEM_ADMIN — the finance convention: full admin EXCEPT signing, so an
--      administrator can never manufacture an approval (segregation of duties).
--    * ACCOUNTANT / DGA — they sign the BON's chain (VISA_COMPTABLE / VISA_DGA),
--      not this one. They gain sign when that workflow ships (11.0E).
--    * No grant for VISA_OPERATIONS: its signer is an unresolved business
--      decision (BLK-FIN-2). Nothing here lets anyone sign that step.
--
--    GOVERNANCE NOTE: CEO holds only finance:read today. Its DG visa is the
--    first write-class finance capability the role has ever had — flagged in
--    11.0A §4 as a deliberate change to surface, not a silent widening.
--
--    Guarded backfills (select-driven): no-ops on an empty DB, where seed.sql
--    owns the data.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:sign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('FINANCE_OFFICER', 'CHIEF_OF_TRANSIT', 'COORDINATOR', 'TREASURER', 'DAF', 'CEO')
on conflict do nothing;

-- The three signing seats that cannot yet READ what they must sign.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'COORDINATOR', 'CEO')
on conflict do nothing;
