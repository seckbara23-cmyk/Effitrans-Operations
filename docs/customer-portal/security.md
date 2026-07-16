# Customer Portal — Security & Isolation

**Phase 7.5A.** Documents the portal's security model and the isolation added for ocean/air
tracking. Foundational auth/isolation predates 7.5A (see [architecture.md](./architecture.md)); this
phase extends it to the ocean/air child tables **without weakening any existing boundary**.

## Identity & no privilege inheritance

- Portal reps authenticate as a **`client_user`** (PK → `auth.users.id`), disjoint from staff
  (`app_user`). A given auth user is in exactly one class.
- Staff RBAC keys on `app_user`/`user_role`; a `client_user` has **zero** `user_role` rows, so
  `has_permission()` / `assertPermission` deny **all** staff, transport, customs, and platform
  capabilities. There is **no inheritance path** — portal users never receive admin/transport/
  customs/platform permissions. (Never grant a `client_user` a `user_role`.)
- The ocean/air tables were staff-only (`transport:read`). 7.5A does **not** give portal users
  `transport:read`; it adds **separate** portal SELECT policies scoped to the customer.

## Every portal query proves tenant + customer + portal-account

Existing helpers `auth_portal_tenant_id()` / `auth_portal_client_id()` (ACTIVE-gated) and
`portal_can_read_file(file_id)` scope the dossier spine. 7.5A adds:

```sql
create function public.portal_can_read_shipment(p_shipment uuid) returns boolean
  security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.shipment s
    join public.operational_file f on f.id = s.file_id
    join public.client_user cu on cu.client_id = f.client_id
    where s.id = p_shipment and cu.id = auth.uid()
      and cu.status = 'ACTIVE' and cu.tenant_id = f.tenant_id);
$$;
```

This proves, in one predicate: the row's shipment belongs to a file owned by the **caller's own
client** (`cu.client_id = f.client_id`), in the **caller's tenant** (`cu.tenant_id = f.tenant_id`),
and the portal account is **ACTIVE**. Additive portal SELECT policies use it on the shipment-linked
child tables:

`ocean_container` · `ocean_tracking_event` · `air_awb` · `air_uld` · `air_cargo_piece` ·
`air_tracking_event`.

The staff policies (OR'd) are untouched, so staff visibility is unchanged.

## Least exposure — reference catalogs stay hidden

Reference/catalog tables (`ocean_vessel`/`ocean_port`/`ocean_voyage`, `air_airline`/`air_airport`/
`air_flight`) are **deliberately NOT** exposed to the portal — exposing them would leak the tenant's
whole vessel/port/flight catalog to any customer. Instead:

- Vessel name / voyage / flight number reach the portal via **denormalized fields** already on the
  tracking events (`vessel_name`, `voyage_reference`, `flight_number`).
- Air origin/destination airport **coordinates** (needed to draw the map endpoints) are resolved by a
  **bounded service-role lookup** of the **owned** shipment's flight — ownership is already proven
  because the AWB was read through the portal RLS client — and the lookup is tenant-filtered
  (`.eq("tenant_id", …)`, enforced by the service-role tenant-scope guard). The catalog is never
  handed to the portal.

## Customer-safe projection

`getPortalCarriage` projects only customer-safe fields: transport mode, vessel/flight, safe
references (MBL/HBL/booking, MAWB/HAWB), the container/ULD list (number/type/status), the milestone
label, and the map projection. It exposes **no** internal IDs, `provider_code`, `fingerprint`,
`created_by`, staff identity, risk scores, or SLA. The shared map renderer's popups already show only
`label/source/confidence/freshness/occurredAt`. Stale/inferred positions render hollow and raise a
warning so a customer never mistakes them for a live GPS fix.

## Reads only — writes stay service-role

The new policies are **SELECT-only**. There are no portal INSERT/UPDATE/DELETE policies anywhere;
all writes remain service-role server actions that re-derive `auth_portal_client_id()` and audit
with `client_user_id`. The authenticated grant on ocean/air tables is SELECT-only.

## CI-proven isolation

[`supabase/tests/rls_portal_carriage_test.sql`](../../supabase/tests/rls_portal_carriage_test.sql)
(wired into the CI `rls-tests` job) proves: an ACTIVE portal user for client A1 sees its **own**
shipment's `ocean_container` / `ocean_tracking_event` / `air_awb` (=1), but **not** another
customer's container in the same tenant (=0), **not** another tenant's (=0); a **DISABLED** portal
user sees nothing (=0); and **staff** (`transport:read`) is unaffected (=1).

## Unchanged principles

Server components; bounded reads (`limit(200)` on events; a fixed parallel read set — no N+1); lazy
map (`next/dynamic ssr:false`, Leaflet off the server bundle); document content and OCR remain
untrusted data. The reuse of the shared projection means there is **one** map-logic path for the
customer shipment surface, not a second implementation.
