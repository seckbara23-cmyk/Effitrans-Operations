import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  applyFileFilters,
  sortFiles,
  isOverdue,
  type FileSearchRow,
} from "@/lib/files/filter";

const row = (over: Partial<FileSearchRow>): FileSearchRow => ({
  id: "id",
  fileNumber: "EFT-IMP-2026-00001",
  type: "IMP",
  status: "OPENED",
  priority: "normal",
  createdAt: "2026-01-01T00:00:00Z",
  accountManagerId: null,
  clientId: "c1",
  clientName: "Dakar Trading",
  origin: "Shanghai",
  destination: "Port de Dakar",
  blAwbRef: "MAEU123456",
  containerRef: "MSCU7654321",
  transportMode: "SEA",
  eta: null,
  ...over,
});

const NOW = new Date("2026-06-14T00:00:00Z");

describe("matchesSearch", () => {
  const r = row({});
  it("matches the file number, full and partial", () => {
    expect(matchesSearch(r, "EFT-IMP-2026-00001")).toBe(true);
    expect(matchesSearch(r, "00001")).toBe(true);
  });
  it("matches client / origin / destination / refs, case-insensitive", () => {
    expect(matchesSearch(r, "dakar trading")).toBe(true);
    expect(matchesSearch(r, "shanghai")).toBe(true);
    expect(matchesSearch(r, "Port de Dakar")).toBe(true);
    expect(matchesSearch(r, "maeu")).toBe(true);
    expect(matchesSearch(r, "MSCU7654321")).toBe(true);
  });
  it("empty term matches everything; unrelated term does not", () => {
    expect(matchesSearch(r, "")).toBe(true);
    expect(matchesSearch(r, "   ")).toBe(true);
    expect(matchesSearch(r, undefined)).toBe(true);
    expect(matchesSearch(r, "rotterdam")).toBe(false);
  });
});

describe("applyFileFilters", () => {
  const rows = [
    row({ id: "a", type: "IMP", status: "IN_PROGRESS", priority: "high", clientId: "c1" }),
    row({ id: "b", type: "EXP", status: "DRAFT", priority: "low", clientId: "c2", clientName: "Niamey SA", origin: "Bamako", destination: "Abidjan", blAwbRef: null, containerRef: null }),
    row({ id: "c", type: "IMP", status: "CLOSED", priority: "critical", clientId: "c1", transportMode: "AIR" }),
  ];

  it("filters by status / type / priority", () => {
    expect(applyFileFilters(rows, { status: "DRAFT" }, NOW).map((r) => r.id)).toEqual(["b"]);
    expect(applyFileFilters(rows, { type: "IMP" }, NOW).map((r) => r.id)).toEqual(["a", "c"]);
    expect(applyFileFilters(rows, { priority: "critical" }, NOW).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by client and transport mode", () => {
    expect(applyFileFilters(rows, { clientId: "c1" }, NOW).map((r) => r.id)).toEqual(["a", "c"]);
    expect(applyFileFilters(rows, { transportMode: "AIR" }, NOW).map((r) => r.id)).toEqual(["c"]);
  });

  it("combines a structured filter with free-text search", () => {
    expect(applyFileFilters(rows, { type: "EXP", search: "bamako" }, NOW).map((r) => r.id)).toEqual(["b"]);
    expect(applyFileFilters(rows, { type: "IMP", search: "bamako" }, NOW)).toEqual([]);
  });

  it("mine requires a matching account manager", () => {
    const mineRows = [row({ id: "x", accountManagerId: "u1" }), row({ id: "y", accountManagerId: "u2" })];
    expect(applyFileFilters(mineRows, { mine: true, currentUserId: "u1" }, NOW).map((r) => r.id)).toEqual(["x"]);
    expect(applyFileFilters(mineRows, { mine: true }, NOW)).toEqual([]);
  });

  it("overdue = ETA passed and not delivered/closed", () => {
    const past = "2026-06-01T00:00:00Z";
    const future = "2026-12-01T00:00:00Z";
    expect(isOverdue(row({ eta: past, status: "IN_PROGRESS" }), NOW)).toBe(true);
    expect(isOverdue(row({ eta: past, status: "DELIVERED" }), NOW)).toBe(false);
    expect(isOverdue(row({ eta: future, status: "OPENED" }), NOW)).toBe(false);
    expect(isOverdue(row({ eta: null }), NOW)).toBe(false);
  });
});

describe("sortFiles", () => {
  const rows = [
    row({ id: "old", fileNumber: "EFT-IMP-2026-00001", createdAt: "2026-01-01T00:00:00Z", priority: "low", status: "CLOSED", clientName: "Zeta" }),
    row({ id: "new", fileNumber: "EFT-IMP-2026-00009", createdAt: "2026-06-01T00:00:00Z", priority: "critical", status: "DRAFT", clientName: "Alpha" }),
  ];

  it("newest (default) and oldest by created_at", () => {
    expect(sortFiles(rows, "newest").map((r) => r.id)).toEqual(["new", "old"]);
    expect(sortFiles(rows, undefined).map((r) => r.id)).toEqual(["new", "old"]);
    expect(sortFiles(rows, "oldest").map((r) => r.id)).toEqual(["old", "new"]);
  });
  it("number, client, priority, status", () => {
    expect(sortFiles(rows, "number").map((r) => r.id)).toEqual(["old", "new"]);
    expect(sortFiles(rows, "client").map((r) => r.id)).toEqual(["new", "old"]); // Alpha < Zeta
    expect(sortFiles(rows, "priority").map((r) => r.id)).toEqual(["new", "old"]); // critical first
    expect(sortFiles(rows, "status").map((r) => r.id)).toEqual(["new", "old"]); // DRAFT before CLOSED
  });
});
