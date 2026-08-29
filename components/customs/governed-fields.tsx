"use client";

/**
 * D4 — the five governed customs elements: capture, certification state, and
 * the governed correction door.
 *
 * WHY THIS IS A SEPARATE BLOCK, not five more inputs on the metadata form. The
 * metadata form edits references that anyone with `customs:update` may change
 * whenever the step is open. These five are different: they feed ICTD, the Chef
 * de Transit certifies them, and once certified they change ONLY through the
 * correction door — a different action, a different permission, a mandatory
 * motif, and a permanent trace. Putting them in the same form as the notes
 * field would say the opposite.
 *
 * The component renders three states of one thing:
 *   1. not certified   — the Déclarant captures, ordinary save
 *   2. certified       — read-only, and the corrector is offered the door
 *   3. corrected       — « À revalider », awaiting a different pair of eyes
 *
 * NO AUTHORITY LIVES HERE. Every flag below decides what is DRAWN. Each action
 * re-asserts its own permission server-side, and the correction RPC reads the
 * old values itself — this UI cannot dictate the authoritative before state,
 * which is the whole point of reading them in the database transaction.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustoms, correctCustoms, revalidateCustoms } from "@/lib/customs/actions";
import { DECLARATION_TYPES } from "@/lib/performance/declaration-type";
import type { CustomsRecord } from "@/lib/customs/types";

const DPI_REGIMES = ["SANS_DPI", "CLIENT_EXPEDITION", "CLIENT_GLOBALE", "EFFITRANS"] as const;
const EXEMPTION_ORIGINS = ["SANS_OBJET", "CLIENT", "EFFITRANS"] as const;
const TARIFF_ORIGINS = ["CLIENT", "EFFITRANS"] as const;

const LABEL = {
  shPositionCount: "Positions SH (NPSH)",
  declarationType: "Type de déclaration",
  dpiRegime: "DPI — prise en charge",
  exemptionTitleOrigin: "Titre d'exonération — préparé par",
  tariffClassificationOrigin: "Origine du classement tarifaire",
} as const;

const DPI_LABEL: Record<string, string> = {
  SANS_DPI: "Sans DPI",
  CLIENT_EXPEDITION: "Client — par expédition",
  CLIENT_GLOBALE: "Client — globale",
  EFFITRANS: "Effitrans",
};
const ORIGIN_LABEL: Record<string, string> = {
  SANS_OBJET: "Sans objet",
  CLIENT: "Client",
  EFFITRANS: "Effitrans",
};

const MESSAGES: Record<string, string> = {
  forbidden: "Vous ne portez pas l'autorisation nécessaire pour cette action.",
  reason_required: "Un motif de correction est obligatoire.",
  not_validated: "Cette information n'est pas encore validée : corrigez-la par la saisie ordinaire.",
  validated_use_correction:
    "Cette information est validée. Elle ne se modifie que par une correction gouvernée, avec motif.",
  no_change: "Aucune valeur n'a changé — une correction doit changer quelque chose.",
  never_corrected: "Ce dossier n'a pas été corrigé : la validation ordinaire s'applique.",
  self_revalidation: "Le correcteur ne peut pas revalider sa propre correction.",
  already_validated: "Cette information est déjà validée.",
  record_failed: "L'enregistrement a été refusé par la base.",
  not_found: "Dossier douanier introuvable.",
};
const say = (code?: string) => MESSAGES[code ?? ""] ?? "Action refusée.";

type Values = {
  shPositionCount: string;
  declarationType: string;
  dpiRegime: string;
  exemptionTitleOrigin: string;
  tariffClassificationOrigin: string;
};

function toValues(record: CustomsRecord): Values {
  return {
    shPositionCount: record.shPositionCount === null ? "" : String(record.shPositionCount),
    declarationType: record.declarationType ?? "",
    dpiRegime: record.dpiRegime ?? "",
    exemptionTitleOrigin: record.exemptionTitleOrigin ?? "",
    tariffClassificationOrigin: record.tariffClassificationOrigin ?? "",
  };
}

function toPayload(v: Values) {
  return {
    shPositionCount: v.shPositionCount === "" ? null : Number(v.shPositionCount),
    declarationType: (v.declarationType || null) as "SIMPLE" | "APE" | "DEP" | "OG" | null,
    dpiRegime: (v.dpiRegime || null) as
      | "SANS_DPI"
      | "CLIENT_EXPEDITION"
      | "CLIENT_GLOBALE"
      | "EFFITRANS"
      | null,
    exemptionTitleOrigin: (v.exemptionTitleOrigin || null) as
      | "SANS_OBJET"
      | "CLIENT"
      | "EFFITRANS"
      | null,
    tariffClassificationOrigin: (v.tariffClassificationOrigin || null) as
      | "CLIENT"
      | "EFFITRANS"
      | null,
  };
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-navy-900">{value || "—"}</span>
    </div>
  );
}

export function GovernedCustomsFields({
  record,
  canUpdate,
  canCorrect,
  canRevalidate,
  awaitingRevalidation,
}: {
  record: CustomsRecord;
  canUpdate: boolean;
  canCorrect: boolean;
  canRevalidate: boolean;
  /** A correction exists and the record is not certified. */
  awaitingRevalidation: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(() => toValues(record));
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");

  // UAT-ICTD-STATE-01 — RESYNC ON NEW SERVER TRUTH.
  //
  // The root cause of the stale panel was here, not in the mutation: `values`
  // was seeded once from `record` and never looked at it again. So after a
  // correction or a revalidation, `router.refresh()` fetched fresh props, the
  // server had the new state, and this component went on rendering the old one
  // from its own memory — which is exactly what "needs F5" looks like.
  //
  // Adjusting state during render on a changed input is React's documented
  // pattern for this and needs no effect. The signature covers the governed
  // values AND the certification instant, because a four-eyes revalidation
  // changes only the latter and must still close the correction form.
  const signature = `${JSON.stringify(toValues(record))}|${record.reviewedAt ?? ""}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setValues(toValues(record));
    setCorrecting(false);
    setReason("");
    setError(null);
  }

  const certified = record.reviewedAt !== null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(say(res.error));
      else {
        after?.();
        router.refresh();
      }
    });
  }

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const editable = (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {LABEL.shPositionCount}
        <input
          type="number"
          min={0}
          value={values.shPositionCount}
          onChange={set("shPositionCount")}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {LABEL.declarationType}
        <select
          value={values.declarationType}
          onChange={set("declarationType")}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {/* Four types. DPE is not among them and never reaches production. */}
          {DECLARATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {LABEL.dpiRegime}
        <select
          value={values.dpiRegime}
          onChange={set("dpiRegime")}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {DPI_REGIMES.map((r) => (
            <option key={r} value={r}>
              {DPI_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {LABEL.exemptionTitleOrigin}
        <select
          value={values.exemptionTitleOrigin}
          onChange={set("exemptionTitleOrigin")}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {EXEMPTION_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {ORIGIN_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {LABEL.tariffClassificationOrigin}
        <select
          value={values.tariffClassificationOrigin}
          onChange={set("tariffClassificationOrigin")}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {TARIFF_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {ORIGIN_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">Éléments douaniers gouvernés</h3>
        {awaitingRevalidation ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            À revalider
          </span>
        ) : certified ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
            Validé
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            En saisie
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Ces cinq éléments alimentent l&apos;ICTD. Le déclarant les saisit, le chef de transit les
        valide ; une fois validés ils ne changent que par une correction motivée et tracée.
      </p>

      {/* ---------------------------------------------------- capture ---- */}
      {!certified && canUpdate && !awaitingRevalidation ? (
        <>
          {editable}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateCustoms(record.id, toPayload(values)))}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {pending ? "Enregistrement…" : "Enregistrer les éléments"}
          </button>
        </>
      ) : null}

      {/* ------------------------------------------------- certified ---- */}
      {certified || awaitingRevalidation || !canUpdate ? (
        <div>
          <ReadOnlyRow label={LABEL.shPositionCount} value={values.shPositionCount} />
          <ReadOnlyRow label={LABEL.declarationType} value={values.declarationType} />
          <ReadOnlyRow label={LABEL.dpiRegime} value={DPI_LABEL[values.dpiRegime] ?? ""} />
          <ReadOnlyRow
            label={LABEL.exemptionTitleOrigin}
            value={ORIGIN_LABEL[values.exemptionTitleOrigin] ?? ""}
          />
          <ReadOnlyRow
            label={LABEL.tariffClassificationOrigin}
            value={ORIGIN_LABEL[values.tariffClassificationOrigin] ?? ""}
          />
        </div>
      ) : null}

      {/* ------------------------------------------------ correction ---- */}
      {certified && canCorrect && !correcting ? (
        <button
          type="button"
          onClick={() => {
            setValues(toValues(record));
            setCorrecting(true);
          }}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50"
        >
          Corriger une information validée
        </button>
      ) : null}

      {certified && canCorrect && correcting ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <p className="text-xs text-amber-800">
            Une correction retire la certification : le dossier passera « À revalider » et devra
            être recertifié par une autre personne. L&apos;ancienne et la nouvelle valeur sont
            conservées définitivement.
          </p>
          {editable}
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Motif de correction (obligatoire)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || reason.trim() === ""}
              onClick={() =>
                run(
                  () => correctCustoms(record.id, { reason, ...toPayload(values) }),
                  () => {
                    setCorrecting(false);
                    setReason("");
                  },
                )
              }
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {pending ? "Correction…" : "Enregistrer la correction"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setCorrecting(false);
                setValues(toValues(record));
                setReason("");
              }}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------- revalidation ---- */}
      {awaitingRevalidation && canRevalidate ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="text-xs text-slate-600">
            Cette information a été corrigée et attend une recertification. Le correcteur ne peut
            pas revalider sa propre correction.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => revalidateCustoms(record.id))}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {pending ? "Revalidation…" : "Revalider"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
