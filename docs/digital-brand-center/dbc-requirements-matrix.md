# DBC — Requirements Matrix

Every CEO-memorandum deliverable, classified against the audited codebase.

Classifications: **SUPPORTED** (existing contract covers it) · **PARTIALLY SUPPORTED**
(existing contract reusable, bounded addition needed) · **MISSING CONTRACT** (no existing
mechanism; new bounded work) · **EXTERNAL ACCOUNT REQUIRED** · **DEFERRED**.

| # | Deliverable | Classification | Rationale | Phase |
|---|---|---|---|---|
| 1 | Executive HTML email signature | **MISSING CONTRACT** | No table-based/Outlook-safe compiler; escaping + brand data reusable (`escapeHtml`, `resolveTenantBranding`) | DBC-2 |
| 2 | Management HTML signature | **MISSING CONTRACT** | Same engine, variant config | DBC-2 |
| 3 | Corporate employee signature | **MISSING CONTRACT** | Same engine + `workforce_profile` fields (title/phones) | DBC-2 |
| 4 | Digital business card (public page) | **PARTIALLY SUPPORTED** | Portal proves the public tenant-branded surface pattern; needs token route + consent/revocation | DBC-3 |
| 5 | vCard | **MISSING CONTRACT** | Pure generator (vCard 3.0 recommended); trivial once identity fields exist | DBC-3 |
| 6 | Dynamic QR code | **MISSING CONTRACT** | No QR lib; QR must encode the **stable profile URL** (dynamic by indirection). Decision: tiny vetted dependency vs. hand-rolled matrix writer | DBC-3 |
| 7 | Apple Wallet pass | **EXTERNAL ACCOUNT REQUIRED → DEFERRED** | Apple Developer account, Pass Type ID, signing cert, pass web service for updates, operational ownership — none exist | post-DBC-6 |
| 8 | Google Wallet pass | **EXTERNAL ACCOUNT REQUIRED → DEFERRED** (optional per memo) | Issuer account, service account, class/object model, Google approval | post-DBC-6 |
| 9 | PowerPoint template | **MISSING CONTRACT** | No PPTX generation; recommend **static approved .pptx master** stored as a brand asset (downloadable); generated decks deferred | DBC-5 |
| 10 | Word letterhead | **PARTIALLY SUPPORTED** | PDF letterhead generatable via existing `PdfDoc`/`ReportLayout`; editable **.docx master** supplied as asset (no DOCX lib) | DBC-4 |
| 11 | Quote template | **PARTIALLY SUPPORTED** | Existing PDF engine + existing quotation data model; avoid a parallel generator | DBC-4 |
| 12 | Invoice template | **PARTIALLY SUPPORTED** | Same engine; align with existing invoice flow (INVOICE_EMAILED) — extend, don't fork | DBC-4 |
| 13 | Commercial proposal template | **PARTIALLY SUPPORTED** | PDF via engine + .docx master for editing | DBC-4 |
| 14 | LinkedIn company banner | **MISSING CONTRACT** | No image generation; recommend fixed approved source files (PNG at LinkedIn's dimensions) as downloadable assets | DBC-5 |
| 15 | CEO LinkedIn banner | **MISSING CONTRACT** | Same | DBC-5 |
| 16 | Social publication template | **MISSING CONTRACT** | Downloadable approved source files; generated images deferred | DBC-5 |
| 17 | Announcement template | **MISSING CONTRACT** | Same | DBC-5 |
| 18 | Marketing email template | **PARTIALLY SUPPORTED** | Table-based portable HTML from the DBC-2 compiler core; merge-tag abstraction for Mailchimp/HubSpot/Dynamics; **no campaign sending** | DBC-6 |
| 19 | Installation & usage guides | **MISSING CONTRACT** (content) | Static tenant-scoped pages/downloads; Outlook/Gmail/Apple Mail/mobile instructions per client | DBC-2/3 |
| 20 | Optimized image & asset package | **MISSING CONTRACT** | Requires the public `brand-assets` bucket (DBC-1) + a ZIP download (streamed, sanitized filenames) | DBC-1/5 |
| — | International memberships block (WCA/FIATA/AWS/EURA) | **MISSING CONTRACT** | Registry table proposed; logos are Brand-Book inputs with usage approval | DBC-1 |
| — | Compliance block (whistleblower button) | **MISSING CONTRACT** | Tenant-configurable URL (server-validated https) + template-controlled copy; URL rendered as a button, never printed | DBC-1/2 |
| — | Sustainability texts | **SUPPORTED** (as template copy) | Fixed approved strings, template-controlled — no schema needed | DBC-2 |
| — | Approved colors / typography | **MISSING INPUT** | No official HEX/CMYK or font files exist anywhere in the codebase — must come from the Brand Book (never invented) | Blocking input |
| — | Executive identity block (A. L. NIANG) | **PARTIALLY SUPPORTED** | `app_user` has name/email; title/phones/WhatsApp need `workforce_profile` | DBC-1 |
| — | Footer line ("Integrated Logistics • …") | **SUPPORTED** (template copy) | Fixed approved string | DBC-2 |
| — | Asset hosting at `effitrans.com/assets/signature/` | **EXTERNAL / UNVERIFIED** | No hosting contract for the marketing site exists in this repo; recommended contract = platform-owned public bucket (DBC-1), website path optional mirror | DBC-1 decision |

**Blocking inputs before DBC-1 implementation:** official color definitions, logo files,
font licences/sources, network logos + usage approvals — see `dbc-asset-checklist.md`.
