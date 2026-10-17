# Effitrans ClamAV scanning worker

The malware scanner the Customs Reference Library's publication gate waits for.
Standalone, containerised, and deliberately ignorant of everything except the
one object it has been asked to scan.

**Nothing here is provisioned or deployed.** This directory is the artefact; the
runbook below is what someone follows to stand it up.

---

## Why the library cannot publish without it

Migration #153 made `scan_status = 'CLEAN'` a precondition for publication, and
only `record_customs_reference_scan` can set it. With no worker, every document
stays `UNSCANNED` and nothing can be published. That is the gate working, not a
fault — and it is why this worker is on the critical path for the feature, not
an optimisation.

---

## The contract, exactly

### Inbound — Effitrans → worker

```
POST /scan
x-effitrans-signature: <hmac_sha256_hex(secret, rawBody)>

{ "document_id", "tenant_id", "storage_path", "sha256",
  "download_url", "nonce", "issued_at" }
```

Answers `202 {accepted:true}`, or `401 bad_signature`, `400 invalid_payload`,
`409 stale_request | duplicate_request`, `503 busy`.

**It must answer within 10 seconds** — Effitrans aborts the dispatch there. So
`/scan` validates and enqueues, and the scan happens afterwards. A worker that
tried to scan synchronously would have every dispatch recorded as failed.

### Outbound — worker → Effitrans

```
POST <EFFITRANS_CALLBACK_URL>
x-effitrans-signature: <hmac_sha256_hex(secret, rawBody)>

{ "document_id", "tenant_id", "storage_path", "sha256",
  "verdict": "CLEAN" | "INFECTED" | "ERROR",
  "nonce", "issued_at", "scanner_version", "engine_ref", "detail" }
```

Three rules that are easy to get wrong:

1. **Echo the nonce.** Effitrans records it under a unique index per
   (tenant, document); a repeat is refused as `replayed`.
2. **Stamp `issued_at` at send time, not at scan time.** Effitrans refuses a
   callback outside ±5 minutes, so a long scan would otherwise produce a
   correct verdict that arrives stale. Retries re-stamp and re-sign.
3. **A 409 is permanent.** It means already-recorded or binding-refused.
   Retrying cannot change it, so the worker stops.

---

## Security model

| Property | How |
|---|---|
| The worker holds **no Supabase credential** | It receives one short-lived signed URL for one object. It cannot list the bucket or read any other document. Compromise yields the shared secret and whatever is in flight — not the library. |
| Both directions authenticated | One shared secret, HMAC-SHA256 over the raw body, constant-time compare. |
| Replay refused twice | Freshness window on `issued_at` **and** a remembered nonce here; Effitrans independently refuses a replayed verdict in the database. |
| clamd never exposed | Binds `127.0.0.1:3310` inside the container. Only the worker's HTTP port is published. |
| Verdict bound to bytes | SHA-256 is verified **before** scanning. A mismatch yields `ERROR` and the bytes are never scanned — a verdict about the wrong object is worse than none. Effitrans re-checks the same binding server-side. |
| Fails closed everywhere | Dead URL, timeout, oversize, clamd error, unrecognised reply → `ERROR`. There is no path from a failure to `CLEAN`. |
| No document or secret in logs | Structured JSON of ids, verdict, byte counts, timings. The signed URL is never logged. |
| Bounded resources | `SCAN_CONCURRENCY` (default 2) and `QUEUE_LIMIT` (50); beyond that it sheds with 503 rather than dying. |

---

## Local development

```bash
cd workers/clamav-scanner
npm test                      # 19 contract tests, no dependencies, no Docker
cp .env.example .env          # then set EFFITRANS_SCAN_SECRET + callback URL
docker build -t effitrans-clamav .
docker run --rm -p 8080:8080 --env-file .env --memory=3g effitrans-clamav
curl -fsS localhost:8080/healthz
```

`/healthz` answers **503 until clamd has loaded its database** — tens of
seconds on first boot. That is intentional: a worker that reported healthy
before clamd was ready would answer `ERROR` to real documents.

### Proving it actually detects malware

The contract tests inject the scanner, so they prove the plumbing and **not**
detection. Detection is proven with EICAR, the standard harmless test
signature, against a running container:

```bash
# In an isolated environment only.
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > /tmp/eicar.txt
# Serve it, point a signed request at it, and expect verdict=INFECTED with
# engine_ref containing "Eicar-Test-Signature".
```

A clean PDF through the same path must come back `CLEAN`. Until both have run
against a real container, treat detection as unproven.

---

## Deployment runbook

1. **Generate the secret** — `openssl rand -hex 32`. Set it as
   `EFFITRANS_SCAN_SECRET` on the worker and `CUSTOMS_SCAN_CALLBACK_SECRET` on
   Effitrans. They must be identical; it signs both directions.
2. **Set `CUSTOMS_SCAN_ENDPOINT`** on Effitrans to the worker's `/scan` URL,
   and `EFFITRANS_CALLBACK_URL` on the worker to Effitrans'
   `/api/customs/reference/scan-callback`.
3. **Deploy the container** with ≥3 GB RAM and TLS terminated in front. Publish
   **only** the worker port; never 3310.
4. **Wait for `/healthz` to report 200** before announcing it. Then upload a
   test PDF in the library, request a scan, and confirm the document reaches
   `CLEAN` and becomes publishable.
5. **Run the EICAR case once** against the deployed worker and confirm the
   document goes `INFECTED` and is retired. A scanner nobody has seen reject
   anything has not been shown to work.
6. **Watch the first week** — `scan.complete` with verdict/ms, and
   `callback.result` with ok/attempts, are the two lines worth alerting on.

### Rollback

Unset `CUSTOMS_SCAN_ENDPOINT` on Effitrans. Scan requests then refuse with
`scanner_unavailable`, nothing new becomes publishable, and already-published
documents are untouched. The worker can be destroyed without data loss — it
stores nothing.

---

## Operating notes

- **Signature updates**: `freshclam` runs as a daemon, checking 12×/day. A
  database more than a few days stale is the main silent failure mode; the
  engine string in `/healthz` is how you check it.
- **Memory**: ClamAV holds its signature database resident — historically
  ~1 GB, and less since the December 2025 signature cleanup. 3–4 GB for the
  container is the safe planning figure.
- **Restarts**: the container is stateless. Losing it mid-scan leaves documents
  `SCANNING`; Effitrans' own 30-minute lost-scan window lets a publisher ask
  again. Nothing is published in the meantime.
