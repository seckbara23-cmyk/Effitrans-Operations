# ClamAV scanning worker for the Effitrans Customs Reference Library.
#
# ONE CONTAINER, TWO PROCESSES, ONE PUBLISHED PORT. clamd listens on
# 127.0.0.1:3310 INSIDE the container and is never published; only the Node
# worker's HTTP port leaves. An exposed clamd is an unauthenticated remote
# file-scanning service, which is precisely what this design exists to avoid.
#
# Debian rather than Alpine: ClamAV on musl has a history of memory-mapping
# quirks with large signature databases, and this box is memory-constrained
# already.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clamav-daemon clamav-freshclam ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# clamd configuration.
#
# The size limits are RAISED ON PURPOSE. Defaults are MaxFileSize 100M and
# MaxScanSize 400M, which already cover the library's 50 MB bucket ceiling —
# these are set explicitly so a future bucket increase is a deliberate edit
# here rather than a silent "file too large" that the worker would, correctly
# but unhelpfully, report as ERROR for ever.
# ---------------------------------------------------------------------------
RUN printf '%s\n' \
      'LogSyslog false' \
      'LogTime true' \
      'Foreground true' \
      'TCPSocket 3310' \
      'TCPAddr 127.0.0.1' \
      'MaxFileSize 128M' \
      'MaxScanSize 512M' \
      'StreamMaxLength 128M' \
      'MaxScanTime 180000' \
      'MaxThreads 4' \
      'User clamav' \
    > /etc/clamav/clamd.conf \
 && printf '%s\n' \
      'Foreground true' \
      'Checks 12' \
      'DatabaseMirror database.clamav.net' \
      'NotifyClamd /etc/clamav/clamd.conf' \
    > /etc/clamav/freshclam.conf

# Bake an initial signature database so a cold start is seconds, not the five
# minutes a first freshclam takes. freshclam still refreshes on boot and every
# two hours after.
RUN freshclam --stdout || true

WORKDIR /app
COPY package.json ./
# No dependencies by design — the worker is Node standard library only, so
# there is no lockfile to drift and no transitive supply chain to audit.
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /var/lib/clamav /var/run/clamav \
 && chown -R clamav:clamav /var/lib/clamav /var/run/clamav

ENV PORT=8080 \
    CLAMD_HOST=127.0.0.1 \
    CLAMD_PORT=3310 \
    SCAN_CONCURRENCY=2 \
    QUEUE_LIMIT=50

EXPOSE 8080

# Reports unhealthy when clamd is not answering, so the platform restarts the
# container instead of letting it answer ERROR to everything while looking up.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
