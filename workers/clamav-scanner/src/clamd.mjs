/**
 * Minimal clamd client — PING and INSTREAM.
 *
 * WHY A SOCKET AND NOT `clamscan`. Spawning the CLI reloads the ~100 MB
 * signature database for every file, which on a 4 GB box is both slow and the
 * most likely way to run out of memory. `clamd` holds the database in memory
 * once and answers over a socket.
 *
 * THE SOCKET IS NEVER PUBLIC. clamd binds to localhost inside the container
 * and only the worker's HTTP port is published. An exposed clamd is an
 * unauthenticated remote file-scanning service with a long history of being a
 * bad idea.
 *
 * INSTREAM, not SCAN-by-path: the bytes are streamed from memory, so the
 * worker never writes a customer document to disk.
 */
import net from "node:net";

/** `PING` → `PONG`. Used by the health check. */
export function ping({ host, port, timeoutMs = 5_000 }) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on("error", () => done(false));
    sock.on("connect", () => sock.write("zPING\0"));
    sock.on("data", (d) => {
      out += d.toString("utf8");
      if (out.includes("PONG")) done(true);
    });
    sock.on("close", () => done(out.includes("PONG")));
  });
}

/** `VERSION` → engine + signature database version, for /healthz. */
export function version({ host, port, timeoutMs = 5_000 }) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    const done = () => {
      sock.destroy();
      resolve(out.replace(/\0/g, "").trim() || null);
    };
    sock.setTimeout(timeoutMs, done);
    sock.on("error", () => resolve(null));
    sock.on("connect", () => sock.write("zVERSION\0"));
    sock.on("data", (d) => {
      out += d.toString("utf8");
      if (out.includes("\0")) done();
    });
    sock.on("close", done);
  });
}

/**
 * Scan a buffer with INSTREAM.
 *
 * Returns `{ verdict, signature, raw }` where verdict is CLEAN | INFECTED |
 * ERROR. ANYTHING that is not an explicit "OK" from clamd is ERROR — a
 * truncated reply, a timeout, a socket error, an unrecognised response. The
 * one thing this function will never do is infer CLEAN from the absence of a
 * clear answer.
 */
export function scanBuffer(buf, { host, port, timeoutMs = 180_000, chunkSize = 64 * 1024 }) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    let settled = false;

    const settle = (v) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    const asError = (why) => settle({ verdict: "ERROR", signature: null, raw: why });

    sock.setTimeout(timeoutMs, () => asError("clamd timeout"));
    sock.on("error", (e) => asError(`clamd socket error: ${e.message}`));

    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += chunkSize) {
        const chunk = buf.subarray(i, Math.min(i + chunkSize, buf.length));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length, 0);
        sock.write(len);
        sock.write(chunk);
      }
      // A zero-length chunk terminates the stream.
      sock.write(Buffer.from([0, 0, 0, 0]));
    });

    sock.on("data", (d) => {
      out += d.toString("utf8");
      if (!out.includes("\0") && !out.includes("\n")) return;
      const reply = out.replace(/\0/g, "").trim();

      if (/\bOK$/.test(reply)) return settle({ verdict: "CLEAN", signature: null, raw: reply });
      if (/\bFOUND$/.test(reply)) {
        const m = /stream:\s*(.+?)\s+FOUND$/.exec(reply);
        return settle({ verdict: "INFECTED", signature: m ? m[1] : "unknown", raw: reply });
      }
      if (/\bERROR$/i.test(reply)) return asError(reply);
      // Size limit exceeded, instream aborted, anything else — not a pass.
      return asError(reply || "unrecognised clamd reply");
    });

    sock.on("close", () => asError(out ? out.replace(/\0/g, "").trim() : "clamd closed early"));
  });
}
