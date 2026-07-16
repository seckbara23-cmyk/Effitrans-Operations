/**
 * Minimal ZIP writer (DBC-4). PURE — no dependency.
 * ---------------------------------------------------------------------------
 * STORED (uncompressed) entries only — enough for a valid .docx (OOXML is a ZIP of small
 * XML parts) without a deflate implementation or a third-party library, consistent with the
 * codebase's hand-rolled generators (PdfDoc). Deterministic (fixed 1980 timestamp).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

function u16(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }
function bytes(s: string): Uint8Array { return new TextEncoder().encode(s); }

/** Build a STORED ZIP archive from the given entries. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = bytes(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    // Local file header (0x04034b50), method 0 = stored.
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ];
    chunks.push(...local, ...name, ...e.data);

    // Central directory record (0x02014b50).
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...Array.from(name),
    );
    offset += local.length + name.length + e.data.length;
  }

  const centralOffset = offset;
  const centralSize = central.length;
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(centralOffset), ...u16(0),
  ];

  return Uint8Array.from([...chunks, ...central, ...eocd]);
}
