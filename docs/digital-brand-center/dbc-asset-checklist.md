# DBC — Missing Brand Inputs Checklist

Items required from Effitrans management / the Brand Book **before DBC-1 implementation**.
None of these exist in the codebase, and none may be invented by engineering.

## Colors (blocking — the memo names them but defines none)
- [ ] Effitrans **Green** — HEX + RGB + CMYK
- [ ] Effitrans **Gold** — HEX + RGB + CMYK
- [ ] **Anthracite Gray** — exact definition (HEX/RGB/CMYK)
- [ ] Approved usage rules (which color for headers / accents / buttons / text)

## Logos (blocking for signatures and documents)
- [ ] Primary logo — approved **SVG** master
- [ ] Reversed (on-dark) logo — SVG
- [ ] Monochrome logo — SVG
- [ ] Approved **PNG fallbacks** (email-safe raster, each ≤100 KB; 1x + 2x)
- [ ] Minimum logo size + clear-space rules + spacing rules
- [ ] Favicon source (also resolves the platform's deferred favicon item)

## Typography
- [ ] Montserrat + Open Sans: approved hosted sources or licensed font files
  (email fallback stack is code-controlled: Calibri → Arial/Helvetica → sans-serif)
- [ ] Any weight restrictions (e.g. Montserrat SemiBold only for headings)

## International networks (each with usage approval)
- [ ] WCA First logo + brand rules + written usage approval (member ID 93972 confirmed)
- [ ] FIATA logo + rules + approval
- [ ] All World Shipping logo + rules + approval
- [ ] EURA (Supplier Member) logo + rules + approval
- [ ] Confirmation none may be recolored/stretched (assumed NO until stated)

## Executive & company identity
- [ ] Approved CEO portrait (if the executive signature/card includes one) — consent + file
- [ ] Physical address (exact approved lines, FR/EN if both)
- [ ] Legal identifiers (RC, NINEA, VAT — whatever must appear on letterhead/invoices)
- [ ] Social-media URLs (LinkedIn company page confirmed; any others)
- [ ] Confirmation of the executive block strings (name, title line, value proposition,
  slogan) exactly as in the memo

## Social & icon set
- [ ] Approved social icons (or approval to use a standard monochrome set recolored to
  brand palette — icons we own, not partner logos)
- [ ] LinkedIn banner source dimensions confirmation (company 1128×191, personal 1584×396
  at time of writing — verify at production)

## Contracts / accounts (decisions, not files)
- [ ] `www.effitrans.com/assets/...` hosting: does the marketing-site hosting contract
  exist, who deploys to it, and is it wanted as a mirror of the platform bucket? (The
  platform-owned public bucket is the recommended primary.)
- [ ] Email-client testing account (Litmus or Email on Acid) — required to claim Outlook
  compatibility with evidence
- [ ] Apple Developer account (only if Wallet is pursued later)
- [ ] Google Wallet issuer account (only if pursued)

## Already answered by the memo (no action)
Approved sustainability strings · compliance block copy · footer line · clickable link
targets (tel/WhatsApp/mailto/website/whistleblower URL) · font names · color names.
