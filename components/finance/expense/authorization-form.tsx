"use client";
/**
 * Autorisation de Dépenses — draft form (Phase 11.0C). Client component.
 * ---------------------------------------------------------------------------
 * Collects EVERY field of the paper document, in the paper's own order, so an
 * operator filling the screen is filling the same form they have always filled.
 * Invokes the permission-gated, audited server actions — it never talks to the
 * database and imports no server-only code.
 *
 * « Montant en lettres » is shown but NOT editable: it is a derived field
 * (11.0A §11), spelled by the same pure function the server stores and the PDF
 * prints, so the figures and the words can never disagree.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createExpenseAuthorizationDraft,
  saveExpenseAuthorization,
  type AuthorizationDraftInput,
} from "@/lib/finance/expense/actions";
import { amountInWordsFr } from "@/lib/finance/expense/amount-in-words";

const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none";
const label = "block text-xs font-medium text-slate-500";

/** Stable French messages for the server action's error vocabulary. */
const ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation d'effectuer cette action.",
  not_found: "Cette autorisation est introuvable.",
  invalid_input: "Vérifiez les champs obligatoires : bénéficiaire, montant et motif.",
  invalid_state: "Cette autorisation n'est plus modifiable.",
  unknown_file: "Aucun dossier ne porte ce numéro.",
  already_exists: "Un document existe déjà pour cette autorisation.",
  not_approved: "L'autorisation n'est pas approuvée.",
};

export type AuthorizationFormValues = {
  accountNumber: string;
  fileNumber: string;
  registrationNumber: string;
  expenseType: string;
  weightKg: string;
  beneficiary: string;
  amount: string;
  currency: string;
  reason: string;
};

const EMPTY: AuthorizationFormValues = {
  accountNumber: "",
  fileNumber: "",
  registrationNumber: "",
  expenseType: "",
  weightKg: "",
  beneficiary: "",
  amount: "",
  currency: "XOF",
  reason: "",
};

/** Form values → the action's input contract. Empty strings clear a field. */
function toInput(v: AuthorizationFormValues): AuthorizationDraftInput {
  return {
    amount: Number(v.amount.replace(",", ".")) || 0,
    currency: v.currency.trim() || "XOF",
    beneficiary: v.beneficiary.trim(),
    reason: v.reason.trim(),
    accountNumber: v.accountNumber.trim(),
    registrationNumber: v.registrationNumber.trim(),
    expenseType: v.expenseType.trim(),
    weightKg: v.weightKg.trim() === "" ? null : Number(v.weightKg.replace(",", ".")),
    fileNumber: v.fileNumber.trim(),
  };
}

export function AuthorizationForm({
  mode,
  authorizationId,
  initial,
}: {
  mode: "create" | "edit";
  authorizationId?: string;
  initial?: Partial<AuthorizationFormValues>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [form, setForm] = useState<AuthorizationFormValues>({ ...EMPTY, ...initial });

  const set = (k: keyof AuthorizationFormValues, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(null);
  };

  const amountNumber = Number(form.amount.replace(",", ".")) || 0;
  const words = amountNumber > 0 ? amountInWordsFr(amountNumber, form.currency || "XOF") : "";

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const payload = toInput(form);
      if (!payload.beneficiary || !payload.reason || payload.amount <= 0) {
        setError(ERRORS.invalid_input);
        return;
      }
      if (mode === "create") {
        const created = await createExpenseAuthorizationDraft(payload);
        if (!created.ok) {
          setError(ERRORS[created.error] ?? "L'enregistrement a échoué.");
          return;
        }
        router.push(`/finance/autorisations-depenses/${created.id}`);
        router.refresh();
        return;
      }

      const res = await saveExpenseAuthorization(authorizationId!, payload);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "L'enregistrement a échoué.");
        return;
      }
      // A frozen version already existed ⇒ the edit created a NEW one (DEC-C13).
      setSaved(
        res.versioned ? `Modification enregistrée — version ${res.versionNumber} figée.` : "Brouillon enregistré.",
      );
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">
        {mode === "create" ? "Nouvelle autorisation de dépenses" : "Modifier l'autorisation"}
      </h2>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {saved && <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800">{saved}</p>}

      {/* The paper form's own order: identification, cargo, beneficiary, amount, motif. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="accountNumber">N° compte</label>
          <input id="accountNumber" className={input} value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="fileNumber">N° dossier</label>
          <input id="fileNumber" className={input} value={form.fileNumber} onChange={(e) => set("fileNumber", e.target.value)} placeholder="Laisser vide : dépense générale" />
        </div>
        <div>
          <label className={label} htmlFor="registrationNumber">N° immatriculation</label>
          <input id="registrationNumber" className={input} value={form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="expenseType">Type</label>
          <input id="expenseType" className={input} value={form.expenseType} onChange={(e) => set("expenseType", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="weightKg">Poids (KG)</label>
          <input id="weightKg" className={input} inputMode="decimal" value={form.weightKg} onChange={(e) => set("weightKg", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="beneficiary">Bénéficiaire *</label>
          <input id="beneficiary" className={input} value={form.beneficiary} onChange={(e) => set("beneficiary", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="amount">Montant *</label>
          <input id="amount" className={input} inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="currency">Devise</label>
          <input id="currency" className={input} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
        </div>
      </div>

      <div>
        <label className={label}>Montant en lettres</label>
        <p className="mt-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
          {words || "—"}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">Calculé automatiquement à partir du montant et de la devise.</p>
      </div>

      <div>
        <label className={label} htmlFor="reason">Observations / Motif *</label>
        <textarea id="reason" rows={3} className={input} value={form.reason} onChange={(e) => set("reason", e.target.value)} />
      </div>

      <button
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {pending ? "Enregistrement…" : mode === "create" ? "Créer le brouillon" : "Enregistrer"}
      </button>
    </div>
  );
}
