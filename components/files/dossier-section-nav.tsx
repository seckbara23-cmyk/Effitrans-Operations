/**
 * Anchor navigation for a long dossier. PURE presentation, no state, no JS.
 * ---------------------------------------------------------------------------
 * OPS-UAT-CONVERGENCE-01 §12. The dossier page is functionally rich and very
 * long; the fix ratified was to reorganise it around the work, not to delete
 * anything. So every section keeps its content and gains a way to be reached.
 *
 * PLAIN `#` LINKS ON PURPOSE. They cost no JavaScript, they survive with
 * scripting disabled, they are addressable and shareable, and — the reason that
 * matters here — they push a history entry the browser's own Back button
 * already understands, so this and APP-NAVIGATION-01 do not need to know about
 * each other.
 *
 * A LINK TO AN ABSENT SECTION IS A DEAD LINK, and a dossier renders different
 * sections for different readers (customs, transport, finance are all permission
 * gated). Every target below is a container this page renders UNCONDITIONALLY;
 * the gated panels sit inside them.
 */

const SECTIONS: readonly { href: string; labelFr: string }[] = [
  { href: "#resume", labelFr: "Résumé" },
  { href: "#documents", labelFr: "Documents" },
  { href: "#douane", labelFr: "Douane" },
  { href: "#transport", labelFr: "Transport" },
  { href: "#finance", labelFr: "Finance" },
  { href: "#qualite", labelFr: "Qualité" },
  { href: "#historique", labelFr: "Historique" },
  { href: "#details", labelFr: "Détails" },
];

export function DossierSectionNav() {
  return (
    <nav aria-label="Sections du dossier" className="overflow-x-auto">
      <ul className="flex min-w-0 flex-wrap gap-1 text-xs">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <a
              href={s.href}
              className="inline-block rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:border-teal-300 hover:text-teal-800"
            >
              {s.labelFr}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
