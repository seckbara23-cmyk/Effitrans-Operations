# LOG-0 — Confidentiality & Source Handling

**Date:** 2026-08-04 · **Repo status: PUBLIC** (github.com/seckbara23-cmyk/Effitrans-Operations)

## 1. Verdict up front

* **No file in the pack is currently tracked by git** — `git ls-files "docs/Logistic Pack"`
  returns 0. Nothing sensitive has been committed. **No blocker.**
* **No real Effitrans operational data was found anywhere in the pack.** Every parsed
  template is blank (`____` / `[à remplir]`); every workbook carries third-party
  freeware demo data; the only email in the letter set is `VOTREEMAIL@VOTRECIE.COM`.
* **The real hazard is copyright, not confidentiality.** The `4-Livres` folder (8 files,
  ~87 MB) plus the transit course PDF are **third-party published works** — the Scribd
  numeric ID prefixes on the filenames say as much. Committing them to a public
  repository would be redistribution of copyrighted material.

## 2. Why this still demanded immediate action

The pack sits **untracked and un-ignored** in a public repo. That is exactly the
configuration that produced the `106423a` incident (two business documents pushed
publicly, followed by a git-filter-repo history purge and a support ticket). One
`git add -A` — the command this project has already banned once — would publish 155 MB
of copyrighted books and third-party freeware to a public repository.

**Action taken in LOG-0** (protective configuration, not a source modification):
`docs/Logistic Pack/` added to `.gitignore`. The sources themselves are untouched —
not moved, not renamed, not rewritten, per the mission.

## 3. Handling matrix

| Category | Files | Never commit publicly? | Why | Treatment |
|---|--:|---|---|---|
| 4-Livres + course PDF (published works) | 9 | **YES — copyright** | third-party publications | ignored; keep local or move to private storage |
| PROGICIELS EXCEL (freeware tools) | 39 | YES | third-party authored tools + demo data; redistribution rights unverified | ignored; retain locally as reference |
| KIT templates (docx) | 67 | YES (precaution) | authorship/licensing of the purchased kit unverified; zero data risk | ignored; **structure described in these analysis docs instead** |
| Planning spreadsheet (sample) | 1 | YES (same) | synthetic sample rows | ignored |
| Exact duplicates | 3 pairs | n/a | `Contrat de Commission de Transit(1)` ≡ non-(1); 2 progiciel pairs | noted; dedup is Effitrans's call, not ours |

## 4. Provenance

SHA-256 recorded for all 120 files in [source-inventory.md](source-inventory.md)
(first 12 hex per file). This makes the analysis auditable against the exact bytes
reviewed without committing a single source file.

## 5. Recommendations

1. **Keep `docs/Logistic Pack/` local-only** (now enforced by `.gitignore`). If the team
   needs shared access, a private storage location (private repo or drive) — never this
   public repo.
2. **No redacted working copies are needed** — there is nothing to redact; the analysis
   documents in this folder carry the full extractable value.
3. If Effitrans later supplies **real** operational files (actual dossiers, invoices,
   SOPs), they must go to a private channel from the start — this public repo has no
   safe place for them.
4. Confirm with the kit's vendor whether the *templates* may be adapted into platform
   document types (usage is presumably licensed; redistribution is not).
