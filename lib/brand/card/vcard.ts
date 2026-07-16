/**
 * vCard 3.0 generator (DBC-3). PURE — deterministic, no I/O.
 * ---------------------------------------------------------------------------
 * Emits a spec-correct vCard 3.0: values escaped (\ ; , and newlines), long lines folded
 * at 75 octets (CRLF + space continuation), CRLF line endings, UTF-8. Encodes only the
 * public card identity — no tenant/user/db ids. The whistleblower URL is NOT included (the
 * card's compliance is a button on the page, not a contact field).
 */
import type { CardModel } from "./model";

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Fold a content line at 75 octets per RFC 2426 (continuation = CRLF + single space). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const take = first ? 75 : 74; // continuation lines lose one octet to the leading space
    let end = Math.min(start + take, bytes.length);
    // Do not split a multi-byte UTF-8 sequence.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((first ? "" : " ") + bytes.slice(start, end).toString("utf8"));
    start = end;
    first = false;
  }
  return out.join("\r\n");
}

function digits(v: string): string {
  return v.replace(/[^0-9+]/g, "");
}

/** Best-effort structured name: last whitespace token is the family name. */
function splitName(full: string): { family: string; given: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { family: "", given: full.trim() };
  const family = parts[parts.length - 1];
  return { family, given: parts.slice(0, -1).join(" ") };
}

export function buildVCard(model: CardModel): string {
  const e = model.employee;
  const name = splitName(e.name);
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`N:${esc(name.family)};${esc(name.given)};;;`);
  lines.push(`FN:${esc(e.name)}`);
  lines.push(`ORG:${esc(model.company.name)}`);
  if (e.title) lines.push(`TITLE:${esc(e.title)}`);
  if (e.department) lines.push(`X-DEPARTMENT:${esc(e.department)}`);
  if (e.phoneOffice) lines.push(`TEL;TYPE=WORK,VOICE:${esc(digits(e.phoneOffice))}`);
  if (e.phoneMobile) lines.push(`TEL;TYPE=CELL,VOICE:${esc(digits(e.phoneMobile))}`);
  lines.push(`EMAIL;TYPE=INTERNET:${esc(e.email)}`);
  if (model.company.website) lines.push(`URL:${esc(model.company.website)}`);
  lines.push(`URL:${esc(model.profileUrl)}`);
  if (model.company.address) lines.push(`ADR;TYPE=WORK:;;${esc(model.company.address)};;;;`);
  if (e.whatsapp) lines.push(`NOTE:WhatsApp: ${esc(e.whatsapp)}`);
  if (e.photoUrl) lines.push(`PHOTO;VALUE=URI:${esc(e.photoUrl)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}
