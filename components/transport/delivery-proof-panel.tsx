/**
 * Delivery proof (UAT-1 POD ownership redesign). Server component, read-only.
 * ---------------------------------------------------------------------------
 * Operations' view of the one piece of evidence it owns after delivery.
 *
 * It deliberately has NO upload control and NO verify button of its own. The
 * document pipeline already provides both, with the catalogue, the size/MIME
 * limits, versioning, maker-checker and the audit trail — a second upload or
 * review path here would be a second system to keep correct. This panel states
 * where the delivery proof stands and points at the existing controls.
 *
 * It renders only once transport has been DELIVERED: before that the POD is not
 * yet anybody's outstanding work, and showing "waiting for upload" from the day
 * a dossier opens is exactly the noise WES-5C removed from the documentation
 * stage.
 */
import Link from "next/link";
import { isVerified, canonicalStatus } from "@/lib/documents/doctrine";

export type DeliveryProofState = {
  /** Transport status; the panel is hidden entirely before DELIVERED. */
  transportStatus: string | null;
  /** Current (non-superseded) delivery note, if one exists. */
  document: { status: string; version: number } | null;
  /** Whether the Finance handoff has been recorded (transport at POD_RECEIVED). */
  podReceived: boolean;
  canUpload: boolean;
  canVerify: boolean;
};

export function DeliveryProofPanel({ fileId, state }: { fileId: string; state: DeliveryProofState }) {
  const rank = state.transportStatus;
  // Before delivery this is not outstanding work.
  if (rank !== "DELIVERED" && rank !== "POD_RECEIVED") return null;

  const doc = state.document;
  const verified = doc ? isVerified(doc.status) : false;
  const rejected = doc ? ["REJECTED", "EXPIRED", "SUPERSEDED"].includes(canonicalStatus(doc.status)) : false;

  const tone = verified
    ? "border-teal-200 bg-teal-50"
    : doc && !rejected
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <section className={`surface space-y-3 rounded-lg border p-4 ${tone}`} id="delivery-proof">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">Preuve de livraison</h2>
        <span className="text-xs text-slate-500">Responsable : Opérations</span>
      </div>

      {!doc && (
        <>
          <p className="text-sm text-slate-700">
            <strong>Statut :</strong> en attente de dépôt
          </p>
          <p className="text-xs text-slate-600">
            La livraison est effectuée. Le bordereau signé est à récupérer auprès du chauffeur ou du
            client, puis à déposer ici — le chauffeur n&apos;a aucune action à faire.
          </p>
          {state.canUpload && (
            <Link
              href={`/files/${fileId}#documents`}
              className="inline-block rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
            >
              Déposer le bordereau signé
            </Link>
          )}
        </>
      )}

      {doc && !verified && !rejected && (
        <>
          <p className="text-sm text-slate-700">
            <strong>Statut :</strong> en attente de vérification
            <span className="ml-2 text-xs text-slate-500">version {doc.version}</span>
          </p>
          <p className="text-xs text-slate-600">
            Le bordereau est déposé. Une personne habilitée doit le vérifier — le déposant ne peut pas
            valider son propre document.
          </p>
          {state.canVerify && (
            <Link
              href={`/files/${fileId}#documents`}
              className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-navy-800 hover:bg-white"
            >
              Vérifier le bordereau
            </Link>
          )}
        </>
      )}

      {doc && rejected && (
        <>
          <p className="text-sm text-slate-700">
            <strong>Statut :</strong> bordereau refusé ou remplacé
          </p>
          <p className="text-xs text-slate-600">
            Un nouveau bordereau signé doit être déposé. La réception n&apos;est pas enregistrée.
          </p>
        </>
      )}

      {verified && (
        <>
          <p className="text-sm font-medium text-teal-800">Preuve de livraison vérifiée ✓</p>
          <p className="text-xs text-slate-600">
            {state.podReceived
              ? "Réception enregistrée automatiquement et dossier transmis à la Facturation."
              : "Réception en cours d'enregistrement."}
          </p>
        </>
      )}
    </section>
  );
}
