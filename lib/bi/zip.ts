/**
 * Minimal STORED (uncompressed) ZIP writer (Phase 3.0 / 3.0B) — PURE,
 * dependency-free. Server + client safe.
 * ---------------------------------------------------------------------------
 * Extracted from ./xlsx so it is shared by BOTH the multi-sheet XLSX writer and
 * the Power BI CSV package (a .zip of RFC-4180 CSVs). No third-party library, no
 * external integration. Entries are stored (no DEFLATE) with a correct CRC-32,
 * which every ZIP reader (incl. Excel/Power BI) accepts.
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

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export type ZipEntry = { name: string; data: Uint8Array };

/** Build a STORED (uncompressed) ZIP from the parts. */
export function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = Array.from(new TextEncoder().encode(e.name));
    const crc = crc32(e.data);
    const size = e.data.length;
    // local file header
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ];
    chunks.push(...local, ...e.data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...nameBytes,
    );
    offset += local.length + size;
  }

  const centralOffset = offset;
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(centralOffset), ...u16(0),
  ];
  return Uint8Array.from([...chunks, ...central, ...eocd]);
}
