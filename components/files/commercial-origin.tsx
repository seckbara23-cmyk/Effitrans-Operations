/**
 * QO-1 — « Origine commerciale » (display only, server component).
 * ---------------------------------------------------------------------------
 * A devis is OPTIONAL: a dossier legitimately originates from an accepted
 * quotation OR directly. This block makes that origin EXPLICIT so a dossier
 * without devis reads as « Sans devis » — a legitimate state — never as
 * missing data.
 *
 *   * Converted dossier → « Devis N° DEV-XXXX ». The NUMBER is origin metadata
 *     of the dossier the reader already holds file:read on; the LINK into the
 *     commercial workspace is offered only to commercial-read holders
 *     (quotation:create / quotation:validate — DEC-C32). Amounts, lines and
 *     any quotation CONTENT never surface here.
 *   * Direct dossier → « Sans devis » with the recorded opening reason beneath
 *     (the cotation step's audited skip reason). « Sans devis » waives NOTHING
 *     downstream — invoicing, customs, documents and approvals are unchanged.
 *
 * The customer portal renders none of this.
 */
import Link from "next/link";

export function CommercialOrigin({
  quotationId,
  devisNumber,
  skipReason,
  canLinkCommercial,
}: {
  quotationId: string | null;
  devisNumber: string | null;
  skipReason: string | null;
  canLinkCommercial: boolean;
}) {
  const fromDevis = quotationId !== null;
  const label = devisNumber ? `Devis N° ${devisNumber}` : "Devis accepté";
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-navy-900">Origine commerciale</h2>
      {fromDevis ? (
        <p className="mt-2 text-sm text-slate-700">
          {canLinkCommercial ? (
            <Link href={`/commercial/quotations/${quotationId}`} className="font-medium text-teal-700 hover:underline">
              {label}
            </Link>
          ) : (
            <span className="font-medium">{label}</span>
          )}
        </p>
      ) : (
        <div className="mt-2">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Sans devis</span>
          {skipReason && <p className="mt-1.5 text-xs text-slate-500">{skipReason}</p>}
        </div>
      )}
    </section>
  );
}
