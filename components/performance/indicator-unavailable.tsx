/**
 * An indicator whose METHOD is ratified but whose SOURCES do not exist yet.
 *
 * The alternative was to hide the tab, or to render zeros. Hiding it makes a
 * ratified indicator look forgotten; zeros make an uncollected fact look like a
 * measured one, and a management module that publishes a fabricated zero is
 * worse than one that publishes nothing. So the tab exists, states what is
 * already proven, and names precisely what is missing before it can compute.
 */
export function IndicatorUnavailable({
  indicator,
  fullName,
  proven,
  missing,
}: {
  indicator: string;
  fullName: string;
  proven: string;
  missing: readonly string[];
}) {
  return (
    <div className="space-y-4">
      <div className="surface p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-navy-900">{fullName}</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Sources non collectées
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-600">{proven}</p>
        <p className="mt-3 text-xs text-slate-500">
          Aucun résultat n&apos;est affiché ici, et c&apos;est délibéré : publier un zéro pour un
          fait qui n&apos;a pas été collecté le ferait passer pour une mesure.
        </p>
      </div>

      <div className="surface p-6">
        <h3 className="text-sm font-semibold text-navy-900">
          Ce qu&apos;il manque pour calculer l&apos;{indicator}
        </h3>
        <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-600">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
