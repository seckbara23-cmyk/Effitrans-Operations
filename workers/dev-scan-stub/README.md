# Dev scan stub — NOT a malware scanner

How to exercise the Customs Reference Library's publication workflow on a
developer's machine when there is no ClamAV, no Docker and no paid scanning
service.

**It detects nothing.** It looks for the EICAR test string and otherwise reports
`CLEAN` because it has no opinion. Everything below is about why that is safe to
have in the repository, and what it does and does not prove.

---

## Why a stub at all

Migration #153 made `scan_status = 'CLEAN'` a precondition for publication, and
only `record_customs_reference_scan` can set it. With no scanner configured,
`scannerConfig()` returns null, every scan request refuses with
`scanner_unavailable`, and **every document stays `UNSCANNED` and unpublishable.**

That is the gate working correctly. It also means the publication half of the
workflow — submit, approve, publish, withdraw, rescan-finds-infection — cannot be
reached at all in development. This stub reaches it.

---

## Why this is not a production bypass

The argument is structural, not a promise:

| | |
|---|---|
| **It is not in the application** | Effitrans has no stub mode, no test flag, no branch that behaves differently. It dispatches to whatever `CUSTOMS_SCAN_ENDPOINT` names and believes a signed callback. There is no Production environment variable that can enable this, because there is nothing in Production to enable. |
| **It cannot reach a deployed environment** | A verdict only matters once delivered. The stub **refuses to start** unless `EFFITRANS_CALLBACK_URL` is loopback. Point a deployed `CUSTOMS_SCAN_ENDPOINT` at a stub and the stub still has nowhere to answer. |
| **Every verdict is labelled, permanently** | `scanner_version` is persisted on the evidence row *and* on the document, and the stub sets it to `DEV-STUB-NOT-A-REAL-SCAN`. Set `CUSTOMS_SCAN_PROVIDER=dev-scan-stub` and `scanner_name` says so too. Two independent fields, in the database, for ever. |
| **It changes no security control** | It signs with the shared secret, echoes the nonce and binds its verdict to the sha256 it was given. The database guard, maker-checker separation, RLS policies and the replay index are untouched. |

The honest residual risk: somebody who already holds Production secrets could
tunnel a loopback address to a deployed callback. That requires deliberate
circumvention by someone who could equally well point Production at any
endpoint they like — it is not a weakness this stub introduces.

---

## Running it

```bash
cd workers/dev-scan-stub
cp .env.example .env            # then set a throwaway secret
DEV_SCAN_STUB_ACK=i-know-this-is-not-a-scanner \
EFFITRANS_SCAN_SECRET=<same as your local CUSTOMS_SCAN_CALLBACK_SECRET> \
EFFITRANS_CALLBACK_URL=http://localhost:3000/api/customs/reference/scan-callback \
  npm start
```

Then, on your **local** Effitrans only:

```
CUSTOMS_SCAN_ENDPOINT=http://127.0.0.1:8099/scan
CUSTOMS_SCAN_CALLBACK_SECRET=<the same secret>
CUSTOMS_SCAN_PROVIDER=dev-scan-stub
```

## What to exercise

1. Upload a PDF → it lands `QUARANTINE` / `UNSCANNED`, unpublishable.
2. Request a scan → `SCANNING`, then the callback lands `CLEAN`.
3. Attest provenance and the legal version, rule on the licence, submit for
   publication, and have a **second** person approve. One person cannot do both:
   `self_approval_forbidden`.
4. Put the EICAR string in a PDF and scan it → `INFECTED`, and a published
   document is withdrawn. This is the path worth seeing work.
5. Confirm in the database that every evidence row reads
   `scanner_version = 'DEV-STUB-NOT-A-REAL-SCAN'`.

## What this does NOT prove

Whether the real scanner detects malware. That needs ClamAV and EICAR against
`workers/clamav-scanner` in a container, and until that has been run, detection
is **unproven** — no number of green stub runs changes that.

## Before production

Delete `CUSTOMS_SCAN_ENDPOINT` or point it at the real worker. Any document
cleared by the stub should be re-scanned: its evidence names a stub, and a
scanner that detects nothing has not cleared anything.
