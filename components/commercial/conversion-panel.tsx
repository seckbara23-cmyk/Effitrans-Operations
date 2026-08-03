"use client";

/**
 * EC-3D — convert an accepted quotation into an operational dossier.
 *
 * The button exists only for a seat holding `file:create`. Everyone else who can
 * read the quotation sees the reason instead, because "Prêtes à convertir" with
 * no way to convert and no explanation is worse than either alternative.
 *
 * The dossier TYPE is asked for, not guessed. Nothing in a quotation tells the
 * platform whether the shipment is an import, an export or a transit, and
 * inferring it would put an invented operational fact into Operations' hands.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { convertQuotationToDossier } from "@/lib/commercial/convert";
// The dossier vocabulary already exists — reuse t.files, do not restate it.
import { t } from "@/lib/i18n";
import type { FileType, Priority } from "@/lib/files/types";

const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "critical"];

export function ConversionPanel({
  quotationId, blockedReason,
}: {
  quotationId: string;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState<FileType>("IMP");
  const [priority, setPriority] = useState<Priority>("normal");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (blockedReason) {
    return <section className="surface p-5 text-sm text-amber-800">{blockedReason}</section>;
  }

  if (done) {
    return (
      <section className="surface p-5 text-sm">
        <p className="text-teal-800">
          Dossier créé. Les Opérations en sont désormais propriétaires : l&apos;ouverture,
          l&apos;affectation et le suivi se poursuivent de leur côté.
        </p>
        <Link href={`/files/${done}`} className="mt-2 inline-block text-navy-900 hover:underline">
          Ouvrir le dossier →
        </Link>
      </section>
    );
  }

  return (
    <section className="surface p-5">
      <h2 className="mb-2 text-base font-semibold text-navy-900">Conversion en dossier</h2>
      <p className="mb-3 text-sm text-slate-600">
        Le dossier est créé par la chaîne Opérations, puis leur appartient. Le Commercial
        n&apos;intervient plus ensuite : il conserve la trace et affiche l&apos;avancement.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Type de dossier</span>
          <select className="field" value={type} onChange={(e) => setType(e.target.value as FileType)}>
            {FILE_TYPES.map((k) => (
              <option key={k} value={k}>{t.files.types[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Priorité</span>
          <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((k) => (
              <option key={k} value={k}>{t.files.priorities[k]}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending}
        className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40"
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await convertQuotationToDossier({
              quotationId,
              type, priority,
            });
            if (!r.ok) { setError(CONVERT_ERRORS[r.error] ?? "Conversion impossible."); return; }
            setDone(r.fileId);
            router.refresh();
          });
        }}
      >
        {pending ? "Création du dossier…" : "Créer le dossier"}
      </button>
    </section>
  );
}

const CONVERT_ERRORS: Record<string, string> = {
  forbidden_create_file:
    "La création d'un dossier relève des Opérations : vous n'avez pas cette autorisation.",
  forbidden_commercial_read: "Vous n'avez pas accès aux cotations.",
  not_found: "Cotation introuvable.",
  not_accepted: "Seule une cotation acceptée par le client peut être convertie.",
  already_converted: "Cette cotation a déjà été convertie en dossier.",
  no_client: "Aucun client n'est rattaché à cette cotation.",
  dossier_creation_refused: "Les Opérations ont refusé la création du dossier.",
  // The dossier EXISTS; only the link failed. Say so, rather than implying nothing happened.
  conversion_not_recorded:
    "Le dossier a été créé mais le lien avec la cotation n'a pas pu être enregistré. Signalez-le : le dossier ne doit pas être recréé.",
};
