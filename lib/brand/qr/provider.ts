import "server-only";

/**
 * QR provider (DBC-3). SERVER-ONLY adapter.
 * ---------------------------------------------------------------------------
 * The ONLY module that touches the `qrcode` dependency — the rest of the app depends on
 * this abstraction, never on the library, so it can be swapped without ripple. QR always
 * encodes a URL (the public card), never raw contact data, so the code survives every
 * profile change and only the token (URL) changes on rotation.
 */
import QRCode from "qrcode";

const OPTS = { margin: 1, errorCorrectionLevel: "M" as const };

export const BrandQrProvider = {
  /** Crisp inline SVG for the page (no extra request, scalable, accessible). */
  async svg(url: string): Promise<string> {
    return QRCode.toString(url, { type: "svg", ...OPTS });
  },
  /** PNG bytes for the download endpoint. */
  async png(url: string, size = 320): Promise<Uint8Array> {
    const buf = await QRCode.toBuffer(url, { type: "png", width: size, ...OPTS });
    return new Uint8Array(buf);
  },
};
