"use client";

/**
 * Dossier work-queue filter bar (Phase 1.4). Client component — drives state
 * through the URL (search params) so the server page re-renders filtered/sorted
 * results. No data fetching here; options are passed in or static unions.
 */
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/i18n";
import type { FileStatus, FileType, Priority, TransportMode } from "@/lib/files/types";

const STATUSES: FileStatus[] = ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED"];
const TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "critical"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];
const SORTS = ["newest", "oldest", "number", "client", "priority", "status"] as const;

const SELECT_CLASS =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

export function FilesFilters({
  clients,
  current,
}: {
  clients: { id: string; name: string }[];
  current: {
    search?: string;
    status?: string;
    type?: string;
    priority?: string;
    client?: string;
    mode?: string;
    sort?: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const f = t.files.filters;

  // Set/replace a single param (clearing it when empty) and navigate.
  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("search");
    setParam("search", typeof value === "string" ? value.trim() : "");
  };

  return (
    <div className="surface space-y-3 p-4">
      <form onSubmit={onSearchSubmit} className="flex gap-2">
        <input
          type="search"
          name="search"
          defaultValue={current.search ?? ""}
          placeholder={f.search}
          className={`${SELECT_CLASS} flex-1`}
          aria-label={f.search}
        />
        <button
          type="submit"
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
        >
          🔍
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <select
          aria-label={f.status}
          value={current.status ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{f.status} · {f.all}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.files.statuses[s]}
            </option>
          ))}
        </select>

        <select
          aria-label={f.type}
          value={current.type ?? ""}
          onChange={(e) => setParam("type", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{f.type} · {f.all}</option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t.files.types[ty]}
            </option>
          ))}
        </select>

        <select
          aria-label={f.priority}
          value={current.priority ?? ""}
          onChange={(e) => setParam("priority", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{f.priority} · {f.all}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t.files.priorities[p]}
            </option>
          ))}
        </select>

        <select
          aria-label={f.client}
          value={current.client ?? ""}
          onChange={(e) => setParam("client", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{f.client} · {f.all}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          aria-label={f.mode}
          value={current.mode ?? ""}
          onChange={(e) => setParam("mode", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{f.mode} · {f.all}</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t.files.modes[m]}
            </option>
          ))}
        </select>

        <select
          aria-label={f.sort}
          value={current.sort ?? "newest"}
          onChange={(e) => setParam("sort", e.target.value)}
          className={`${SELECT_CLASS} ml-auto`}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {f.sort}: {t.files.sortOptions[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
