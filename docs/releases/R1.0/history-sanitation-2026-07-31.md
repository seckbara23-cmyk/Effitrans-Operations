# Repository history sanitation — 2026-07-31

**Type:** repository hygiene. **Not** a code, schema, configuration or behaviour change.
**Authorised by:** the operator, explicitly, after a written pre-execution report.

## Why

Two business documents were committed by mistake into a **public** repository. The
committing action used `git add -A`, which swept in files that had been deliberately left
untracked. They were untracked again in the next commit, but untracking does not remove a
blob from history — only a history rewrite does.

| Path (exact) | Blob | Size |
|---|---|---|
| `Effitrand SaaS Discovery Questionnaire.docx` | `23b3466a4c675302caea526cadd07f6d31cc88ce` | 130 450 B |
| `Effitrans-Plateforme-Presentation.pptx` | `91d23da473e563f74e8dfc4c28fd6b76bac04a4b` | 87 269 B |

`.vscode/mcp.json`, swept in by the same mistake, was **deliberately left in history**: it
holds no credentials (an `npx` server reference only) and the purge was scoped to the two
documents.

## What was done

```
git filter-repo --invert-paths \
  --path "Effitrand SaaS Discovery Questionnaire.docx" \
  --path "Effitrans-Plateforme-Presentation.pptx" --force
git push --force-with-lease=main:1f45c702c4d9a894b0a77df3ab4fdd30fc066f5e origin main
```

Preceded by a full `git bundle create --all` backup and a dry run on a mirror clone whose
result matched the live run exactly, commit for commit.

## SHA mapping — 5 changed, 309 unchanged, 314 preserved

| Old | New | Commit |
|---|---|---|
| `106423a` | `733c116` | Invoice PDF: correct the geometry (DEF-R10-05) and pin byte integrity |
| `9909399` | `dcd69f6` | Untrack files committed by mistake |
| `8eaaea6` | `246d96a` | B3 PASS recorded; OBS-R10-07 delete control is an expected gate |
| `473caab` | `58cd1c3` | B2 IN PROGRESS: positive target confirmed |
| `1f45c70` | `0fc5a38` | B2 PASS with the operator's stated limitation |

**The SHAs changed because the repository's history was sanitised, not because anything the
application does changed.** Every commit's tree is byte-identical to before except for the
absence of the two documents in `733c116`. No commit was lost, reordered or squashed; the
309 commits preceding the rewrite keep their original identifiers, which is why every SHA
cited in the other release documents still resolves.

## Verification (fresh clone from `origin`, after the push)

| Check | Result |
|---|---|
| Commits touching either path, all refs | **0** |
| `.docx` / `.pptx` in the object listing | **none** |
| `git cat-file -e 23b3466a…` | **absent** |
| `git cat-file -e 91d23da4…` | **absent** |
| `main` | `0fc5a38a8d72e93b6f24407340e2d389b80fc8e4` |
| Refs carrying either blob | none — one branch, **no tags**, no stashes |
| Commit count | 314 (unchanged) |

## What a rewrite does not achieve

**Treat both documents as disclosed.** They were reachable in a public repository between
their commit and the purge. GitHub may continue to serve the old commits by SHA until it
garbage-collects; forks, clones, caches and crawlers are outside anyone's control. The
identifiers needed for a GitHub Support removal request are the five old SHAs and the two
blob hashes above.

Textual *mentions* of the questionnaire remained in three documents after the purge and were
generalised in the same follow-up commit — the filename and a personal/client contact name
were redacted while the provenance (what the source was, its version, its date) was kept.

## Prevention

`.gitignore` now carries `*.docx`, `*.pptx` and `.vscode/mcp.json`. The underlying lesson is
narrower and more useful: **stage by path, never `git add -A`**, in a repository that is
public and where untracked files are untracked on purpose.
