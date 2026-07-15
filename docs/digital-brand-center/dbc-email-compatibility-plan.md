# DBC — Email Signature Compatibility Plan

## Engine decision (recommended)
A **deterministic, server-side string compiler** — pure functions producing table-based,
inline-CSS HTML (the same architecture as the existing `lib/comms/render.ts` + the PDF
engine: pure, node-testable, no DOM). **React-rendered browser markup is NOT the email
output** — React may render the *preview* from the same compiled string, but the artifact
users copy/download is the compiler's output, byte-for-byte.

### Hard constraints encoded in the compiler (per memo + Outlook reality)
- `<table>` layout only — no `<div>` positioning, no Flexbox, no Grid, no `position`.
- All CSS inline; no `<style>` blocks relied upon (Gmail clips, Outlook ignores half).
- No JavaScript, no external CSS, no web fonts in the email itself — font stack
  `Calibri, 'Segoe UI', Arial, Helvetica, sans-serif` (Montserrat/Open Sans appear only in
  raster assets and web surfaces).
- **No VML.** Rounded/imaged buttons need VML in Outlook Desktop; the design uses flat
  rectangular buttons (a `<td>` with `bgcolor` + padding + a plain link) so VML is never
  required. This is a design commitment, stated up front.
- Images: PNG only (no SVG — unsupported in Outlook), self-hosted on stable public
  bucket URLs, explicit `width`/`height` attributes, `alt` text mandatory, ≤100 KB each,
  2x-resolution served at 1x dimensions for retina.
- Total width ≤ 600 px; readable at mobile widths without media queries (single-column
  fallback stacking via nested tables, not CSS).
- Every dynamic value HTML-escaped (`escapeHtml`); links restricted to
  `https:`/`mailto:`/`tel:` (+ `https://wa.me/…`).
- The whistleblower URL appears **only** as a button `href`, never as visible text.

## Variants
One data model, three configs: **EXECUTIVE** (full block: portrait?, memberships,
compliance, sustainability), **MANAGEMENT** (no portrait, memberships, compliance),
**CORPORATE** (compact: identity, contacts, footer, sustainability line). Variant config
controls sections, not markup dialects — one compiler.

## Delivery formats
- Copy-to-clipboard (rendered rich copy for Gmail/Apple Mail paste)
- Downloadable `.html` file (source of truth)
- Outlook install package: `.htm` + step-by-step guide (Signatures folder method for
  Desktop; roaming signatures note for New Outlook/365)
- Gmail: paste method guide (Gmail strips `<style>`; inline CSS survives)
- Apple Mail (macOS/iOS) and mobile instructions as static guide pages

## Test matrix (no compatibility claim without evidence)
| Client | Renderer | Priority | Known risks |
|---|---|---|---|
| Outlook Desktop Windows (2016/2019/365) | Word | **P0** | table widths, image scaling, line-height |
| New Outlook (Windows) | WebView | P0 | roaming signature storage |
| Outlook Web / Microsoft 365 | Web | P0 | style stripping |
| Gmail Web | Web | **P0** | clips >102 KB messages; class stripping |
| Gmail Android / iOS | App | P1 | width overflow |
| Apple Mail macOS | WebKit | P1 | generally faithful |
| Apple Mail iOS | WebKit | P1 | auto-scaling |
| Samsung Mail / Android native | varies | P2 | best-effort |

**Method:** (a) the compiler's unit tests assert the structural constraints (tables-only,
inline-only, no script, escaped values, widths, alts) — automatic, in CI; (b) real-client
rendering requires a **Litmus or Email on Acid account (external decision)** or a manual
device pass with the P0 clients above, screenshots archived per signature variant.

**Approval criteria:** all P0 clients render identity, links, buttons, and images
correctly at desktop + mobile widths; no horizontal scroll; alt texts present; links
clickable (tel/WhatsApp/mailto verified on a phone). P1 verified before company-wide
rollout; P2 best-effort documented.

**Known limitations (stated, not hidden):** Outlook Desktop ignores border-radius (flat
buttons by design); dark-mode color inversion varies by client (test both modes; the
palette must keep contrast when inverted); previously-sent emails keep old asset versions.
