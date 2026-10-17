#!/bin/sh
# Start freshclam and clamd, wait for clamd to actually answer, then the worker.
#
# THE WAIT IS NOT COSMETIC. clamd takes tens of seconds to load its signature
# database, and a worker that started first would answer ERROR to every scan in
# the meantime — which Effitrans would faithfully record as failed scans on
# real documents.
#
# The readiness probe is Node, not netcat: node is guaranteed present in this
# image and `nc` is not installed in the slim base.
set -eu

echo '{"event":"entrypoint.start"}'

# Signature updates in the background: every 2 hours (Checks 12).
freshclam --daemon --stdout &

# clamd in the background, bound to localhost only (see clamd.conf).
clamd --config-file=/etc/clamav/clamd.conf &

if node -e '
const net = require("node:net");
const deadline = Date.now() + 240000;
const tryPing = () => new Promise((resolve) => {
  const s = net.createConnection({ host: "127.0.0.1", port: 3310 });
  let out = "";
  const done = (v) => { s.destroy(); resolve(v); };
  s.setTimeout(2000, () => done(false));
  s.on("error", () => done(false));
  s.on("connect", () => s.write("zPING\0"));
  s.on("data", (d) => { out += d; if (out.includes("PONG")) done(true); });
  s.on("close", () => done(out.includes("PONG")));
});
(async () => {
  while (Date.now() < deadline) {
    if (await tryPing()) { console.log(JSON.stringify({event:"entrypoint.clamd_ready"})); process.exit(0); }
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.exit(1);
})();
'; then
  :
else
  echo '{"event":"entrypoint.clamd_not_ready","action":"starting worker anyway; /healthz reports 503 and the platform restarts us"}'
fi

echo '{"event":"entrypoint.worker_start"}'
exec node src/server.mjs
