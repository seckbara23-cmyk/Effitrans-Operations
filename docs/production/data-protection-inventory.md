# Data Protection Inventory — Engineering Input for Counsel (Gate C7)

Prepared for the Senegal data-protection (CDP) review. This is the **engineering fact base**,
derived from the codebase at the 8.0B commit — it is *not* a legal assessment. Questions for
counsel are marked **[Q]**.

## 1. Categories of personal data processed

| Category | Data | Subjects | Where |
|---|---|---|---|
| Staff identity | name, business email, role, presence timestamps (`last_seen_at`), login timestamps | employees | `app_user`, `user_role`, Supabase `auth.users` |
| Portal identity | name, email, login/last-seen timestamps, password hash (Supabase Auth) | customer employees | `client_user`, `auth.users` |
| Customer/commercial | company names, contacts, addresses, dossier references, shipment routes | client companies (incl. sole traders — personal data) | `client`, `operational_file`, `shipment` |
| Financial | invoices, line amounts, payments, balances | client companies | `invoice`, `invoice_line`, `payment` |
| Documents | commercial invoices, BL/AWB, packing lists, certificates, customs declarations — may embed personal data of third parties (consignees, drivers) | varied | private `documents` bucket + `document` table |
| Driver operations | driver name, assigned vehicle plate, trip status, POD | employees/contractors | `transport_record`, driver portal |
| Tracking coordinates | manual position events (lat/lon + timestamp) for shipments; road GPS fixes **only when real-time tracking flags are enabled — currently DARK** | shipments (indirectly drivers) | `ocean_tracking_event`, `air_tracking_event`, `tracking_position` |
| Communications | invitation/welcome emails, customer notifications (title/body), contact-center messages | staff + customer users | `communication`, `client_notification` |
| Audit | actor ids, action names, safe metadata (never message bodies, never AI prompts/answers) | staff + portal users | `audit_log` (append-only) |
| Brand Center | employee names/titles/photos on business cards & signatures; public card pages behind capability tokens | employees | brand tables + public `brand-assets` bucket |

Deliberate minimizations already in code: driver personal phone never shared unless
`EFFITRANS_SHARE_DRIVER_PHONE=true` (default false); portal officer contact shows business
channels only; temp passwords never emailed by default; AI audit stores metadata only.

## 2. Storage regions

| Store | Provider | Region |
|---|---|---|
| Database + Auth + Storage | Supabase | **[operator to confirm project region — provisional per BLK-9]**; likely EU/US — outside Senegal |
| Application hosting/logs | Vercel | functions `iad1` (US-East); logs at Vercel (US/EU) |
| Email delivery | Resend (when enabled) | US/EU infrastructure |
| AI inference (when enabled) | OpenAI API | US |
| Map tiles | OpenStreetMap default (or configured provider) | tile requests expose the **viewer's IP** to the tile host; shipment coordinates appear in tile URLs' surroundings only as map extents, not as data sent |

**[Q]** Cross-border transfer obligations under Senegal's Law 2008-12 / CDP doctrine for each of
the above; whether CDP declaration/authorization is required before pilot or GA.

## 3. AI-provider transfers (currently DISABLED in production)

When enabled (gate C5, Preview first): bounded operational summaries are sent to OpenAI —
dossier/shipment references, client **company names**, statuses, dates, amounts (finance-gated),
document type labels. **Never sent:** document bodies/content, customer contact details, portal
message bodies, internal notes, credentials. The customer assistant sends only that customer's own
already-visible data. Prompts/answers are not persisted anywhere (session-only UI, metadata-only
audit). **[Q]** whether client-company names in prompts constitute personal data requiring notice
/consent; whether an OpenAI DPA (available via OpenAI's standard terms, no training on API data)
suffices.

## 4. Retention & deletion (current behavior — decisions needed)

| Data | Current behavior | **[Q]** needed policy |
|---|---|---|
| Dossiers/shipments/finance | retained indefinitely; soft-delete (`deleted_at`) on operational records | statutory commercial/customs retention (customs docs commonly 5–10 y) |
| Documents (files) | retained; soft-delete flags; no purge job | same |
| Audit log | append-only, no purge (DB-enforced) | retention period + legal basis |
| Portal/staff accounts | disabled status (no erasure flow) | right-to-erasure procedure for identity data vs. retained business records |
| Tracking events | retained | coordinate retention period |
| Notifications/communications | retained | " |
| Backups | per Supabase plan (gate C2 documents) | backup retention alignment |

There is currently **no automated deletion/anonymization job** — a policy decision then an
engineering task.

## 5. Access model (who sees what)

Tenant isolation by Postgres RLS (CI-verified per release); role-based permissions (23 roles);
customers see only their own company's dossiers via portal RLS; platform admins are a separate
identity with platform-scoped access; public card pages expose only fields the employee's card
template includes, behind rotating capability tokens, `noindex`.

## 6. Subprocessor list (for notices/DPAs)

| Subprocessor | Purpose | Engaged when |
|---|---|---|
| Supabase Inc. | database, auth, file storage | always |
| Vercel Inc. | hosting, logs | always |
| Resend Inc. | transactional email | when email enabled (C4) |
| OpenAI LLC | AI inference | only if AI enabled after C5 |
| Microsoft (Azure Document Intelligence) | OCR | **not engaged** — conditional on signed DPA (7.4C-0) |
| OpenStreetMap Foundation (or commercial tile provider) | map tiles | when maps viewed |
| Google (OAuth) | optional staff/portal sign-in | when used |

## 7. Consent & notices — current state

No privacy notice exists in the portal or staff app; no consent flow beyond contractual
onboarding. **[Q]** required notices (portal users, employees, drivers), CDP declaration timing,
and whether pilot (internal + 1–2 consenting friendly customers, synthetic data first) can proceed
under legitimate-interest/contractual bases while notices are drafted.

## 8. Engineering commitments already in force

TLS everywhere (HSTS preload); RLS as hard boundary; append-only audit; secrets never in repo or
client bundles; document bucket private with signed URLs; AI dark in production; payments dark;
real-time GPS dark; per-surface rate limits; session revocation; tenant lifecycle blocking.
