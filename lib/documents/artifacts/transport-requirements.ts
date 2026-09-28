/**
 * What the TRANSPORT panel owes the transport documents (FIN-TRN-DOC-01). PURE.
 * ---------------------------------------------------------------------------
 * The generator already refuses a Demande or an Ordre whose mandatory source
 * fields are absent, and names them in French. What nothing said was WHERE those
 * fields are filled — so on EFT-IMP-2026-00013 the artifact panel reported
 * « Données insuffisantes … Enlèvement prévu » while the transport panel three
 * sections below rendered « Enlèvement prévu » as one more optional box, and
 * three separate edits of that record over two days never touched it.
 *
 * This module answers the operator's question from the SAME contract the
 * refusal comes from — `mandatoryFieldsFor` for the rule, `SOURCE_FIELD_LABELS_FR`
 * for the wording, `TRANSPORT_OWNED_SOURCE_FIELDS` for the scope. No mandatory
 * field is declared here; nothing is duplicated in JSX; RQ-18's subcontracted
 * branch is honoured because the rule itself honours it.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. A gap list being empty does NOT mean the
 * document will generate: `fileNumber` and `clientName` are mandatory too and
 * belong to the dossier, not to this panel. The panel states what IT is holding
 * up, and the artifact panel remains the authority on whether the source is
 * complete. Nothing here fills, defaults or derives a value — least of all a
 * planned date, which is a commitment an operator makes and the platform must
 * never invent (DEC-FIN-TRN-03).
 */
import { onDemandArtifacts } from "./feasibility";
import {
  artifactsRequiringSourceField,
  isTransportOwnedSourceField,
  mandatoryFieldsFor,
  SOURCE_FIELD_LABELS_FR,
  type ArtifactSourceInput,
  type TransportOwnedSourceField,
} from "./source";

/**
 * The artifact-source fields a transport record carries, as the source contract
 * names them. `providerId` selects the execution branch and is never rendered.
 *
 * Derived from `TransportOwnedSourceField`, so the panel's input set and the
 * "corrected here" set are the same set by construction.
 */
export type TransportSourceFields = Pick<
  ArtifactSourceInput,
  TransportOwnedSourceField | "providerId"
>;

export type TransportArtifactGap = {
  artifactCode: string;
  labelFr: string;
  /** Mandatory fields this panel owns that are still empty. Never the others. */
  missing: { field: string; labelFr: string }[];
};

const filled = (v: string | null | undefined): boolean => (v ?? "").trim().length > 0;

const labelFor = (field: string): string => SOURCE_FIELD_LABELS_FR[field] ?? field;

/** The on-demand artifacts, by code, in registry order. */
const onDemandCodes = (): string[] => onDemandArtifacts().map((a) => a.code);

/**
 * Per on-demand artifact: which transport-owned mandatory fields are still
 * empty on this record. Artifacts with nothing outstanding here are omitted.
 */
export function transportArtifactGaps(record: TransportSourceFields): TransportArtifactGap[] {
  const gaps: TransportArtifactGap[] = [];

  for (const artifact of onDemandArtifacts()) {
    const mandatory = mandatoryFieldsFor(artifact.code, record) ?? [];
    const missing = mandatory
      .filter(isTransportOwnedSourceField)
      .filter((f) => !filled(record[f]))
      .map((f) => ({ field: String(f), labelFr: labelFor(String(f)) }));

    if (missing.length > 0) {
      gaps.push({ artifactCode: artifact.code, labelFr: artifact.labelFr, missing });
    }
  }

  return gaps;
}

/**
 * The French names of the on-demand artifacts that require this field on this
 * transport's branch — for the hint rendered beside the input itself.
 *
 * Stated whether or not the field is currently filled: it is a property of the
 * document contract, not of today's data.
 */
export function artifactLabelsRequiringField(
  field: keyof TransportSourceFields,
  record: Pick<TransportSourceFields, "providerId">,
): string[] {
  const codes = artifactsRequiringSourceField(field, onDemandCodes(), record);
  const byCode = new Map(onDemandArtifacts().map((a) => [a.code, a.labelFr]));
  return codes.map((c) => byCode.get(c) ?? c);
}
