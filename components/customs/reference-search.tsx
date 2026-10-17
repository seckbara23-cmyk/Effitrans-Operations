/**
 * Customs Reference Library — the search form. CUSTOMS-REF-01A / REF-2.
 * ---------------------------------------------------------------------------
 * A PLAIN GET FORM, not a controlled component. The axes live in the URL, so a
 * search is linkable, survives a refresh, and is what the server actually
 * filtered on — there is no client-side copy of the library to disagree with
 * the server's answer. The server re-reads every parameter and re-applies the
 * viewer's permission, so nothing here is a boundary.
 *
 * The status axis is rendered only for a publisher. A plain reader is pinned to
 * PUBLISHED by `getLibrary`, and offering them a control that cannot change
 * what they see would be a lie about their own access.
 */
import { CATEGORY_LABEL_FR, REFERENCE_CATEGORIES, REFERENCE_STATUSES, STATUS_LABEL_FR } from "@/lib/customs/reference/types";
import { t } from "@/lib/i18n";

const field = "mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const label = "text-xs font-medium text-slate-600";

export function ReferenceSearch({
  canPublish,
  current,
  resultCount,
}: {
  canPublish: boolean;
  current: {
    q?: string;
    category?: string;
    regime?: string;
    source?: string;
    version?: string;
    status?: string;
    currentOnly?: boolean;
  };
  resultCount: number;
}) {
  const s = t.customs.reference.search;
  return (
    <form method="GET" className="surface p-6" role="search">
      <fieldset>
        <legend className="text-sm font-semibold text-slate-800">{s.legend}</legend>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className={label}>{s.q}</span>
            <input
              type="search"
              name="q"
              defaultValue={current.q ?? ""}
              placeholder={s.qPlaceholder}
              className={field}
            />
          </label>

          <label className="block">
            <span className={label}>{t.customs.reference.fields.category}</span>
            <select name="category" defaultValue={current.category ?? ""} className={field}>
              <option value="">{s.anyCategory}</option>
              {REFERENCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL_FR[c]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={label}>{s.regime}</span>
            <input type="text" name="regime" defaultValue={current.regime ?? ""} className={field} />
          </label>

          <label className="block">
            <span className={label}>{s.source}</span>
            <input type="text" name="source" defaultValue={current.source ?? ""} className={field} />
          </label>

          <label className="block">
            <span className={label}>{s.version}</span>
            <input
              type="number"
              name="version"
              min={1}
              step={1}
              defaultValue={current.version ?? ""}
              className={field}
            />
          </label>

          {canPublish && (
            <label className="block">
              <span className={label}>{s.status}</span>
              <select name="status" defaultValue={current.status ?? ""} className={field}>
                <option value="">{s.anyStatus}</option>
                {REFERENCE_STATUSES.map((st) => (
                  <option key={st} value={st}>{STATUS_LABEL_FR[st]}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              name="currentOnly"
              value="1"
              defaultChecked={current.currentOnly ?? false}
              className="rounded border-slate-300"
            />
            {s.currentOnly}
          </label>

          <button
            type="submit"
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            {s.apply}
          </button>
          {/* A link, not a reset button: reset would restore the submitted
              values, and what the operator wants is no filter at all. */}
          <a href="/customs/reference" className="text-xs text-slate-600 underline">
            {s.reset}
          </a>

          <span className="ml-auto text-xs text-slate-500">
            {s.results.replace("{count}", String(resultCount))}
          </span>
        </div>
      </fieldset>
    </form>
  );
}
