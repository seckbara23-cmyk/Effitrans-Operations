"use client";

/**
 * Tenant branding editor + live preview (Phase 6.0E-1). CLIENT.
 * ---------------------------------------------------------------------------
 * Edits the SAFE text + theme values of tenant_branding and shows a live, LOCAL
 * preview of a mock tenant surface before saving. Nothing here holds authority: it
 * calls the platform-gated updateTenantBranding action, which re-validates and
 * re-authorizes. The preview mutates only local state — changing a field performs NO
 * tenant operation, never enters or impersonates the tenant, and Cancel restores the
 * persisted values exactly.
 *
 * Logo / favicon upload is DEFERRED (no approved public storage bucket): the preview
 * renders a wordmark from the display name. The existing logo_url is preserved by the
 * server (this form never sends it).
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTenantBranding } from "@/lib/platform/branding-actions";
import { validateBrandingDraft, type BrandingDraft, type EditableBrandingField, type BrandingFieldError } from "@/lib/branding/edit";
import type { TenantBrandingRow } from "@/lib/branding/types";

const FIELD_ERROR_FR: Record<BrandingFieldError, string> = {
  invalid_color: "Couleur hexadécimale invalide (ex. #0F766E).",
  invalid_text: "Les chevrons < > ne sont pas autorisés.",
  invalid_email: "Adresse e-mail invalide.",
};

const FALLBACK_PRIMARY = "#0F766E";
const FALLBACK_SECONDARY = "#334155";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function rowToDraft(row: TenantBrandingRow | null): BrandingDraft {
  return {
    display_name: row?.display_name ?? "",
    primary_color: row?.primary_color ?? "",
    secondary_color: row?.secondary_color ?? "",
    tagline: row?.tagline ?? "",
    support_email: row?.support_email ?? "",
    support_phone: row?.support_phone ?? "",
    email_footer: row?.email_footer ?? "",
    pdf_header_text: row?.pdf_header_text ?? "",
    invoice_footer_text: row?.invoice_footer_text ?? "",
  };
}

export function BrandingEditor({
  tenantId,
  initial,
  orgDisplayName,
}: {
  tenantId: string;
  initial: TenantBrandingRow | null;
  /** The organization's name — the display-name fallback in the preview when the field is empty. */
  orgDisplayName: string;
}) {
  const router = useRouter();
  const persisted = useMemo(() => rowToDraft(initial), [initial]);
  const [draft, setDraft] = useState<BrandingDraft>(persisted);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  const dirty = useMemo(
    () => (Object.keys(persisted) as EditableBrandingField[]).some((k) => (draft[k] ?? "") !== (persisted[k] ?? "")),
    [draft, persisted],
  );

  // Client-side validation mirrors the server's pure validator (same module).
  const validation = useMemo(() => validateBrandingDraft(draft), [draft]);
  const fieldErrors = validation.ok ? {} : validation.errors;

  const set = (field: EditableBrandingField, value: string) => {
    setStatus(null);
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const displayName = (draft.display_name || "").trim() || orgDisplayName;
  const primary = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(draft.primary_color ?? "") ? draft.primary_color! : FALLBACK_PRIMARY;
  const secondary = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(draft.secondary_color ?? "") ? draft.secondary_color! : FALLBACK_SECONDARY;

  function onSave() {
    if (!validation.ok) {
      setStatus({ tone: "error", message: "Corrigez les champs signalés avant d'enregistrer." });
      statusRef.current?.focus();
      return;
    }
    setStatus(null);
    startTransition(async () => {
      const res = await updateTenantBranding(tenantId, draft);
      if (res.ok) {
        setStatus({
          tone: "ok",
          message: res.changed.length ? `Marque enregistrée (${res.changed.length} champ(s) modifié(s)).` : "Aucun changement à enregistrer.",
        });
        router.refresh();
      } else if (res.error === "validation") {
        setStatus({ tone: "error", message: "Certains champs sont invalides." });
      } else if (res.error === "unauthorized") {
        setStatus({ tone: "error", message: "Action non autorisée." });
      } else {
        setStatus({ tone: "error", message: "Échec de l'enregistrement." });
      }
      statusRef.current?.focus();
    });
  }

  function onCancel() {
    setDraft(persisted);
    setStatus(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ------------------------------------------------------------ form ---- */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-5" aria-label="Éditeur de marque">
        <h2 className="mb-1 text-sm font-semibold text-white">Image de marque du tenant</h2>
        <p className="mb-4 text-xs text-slate-400">
          Valeurs utilisées dans les e-mails, PDF et le portail. Le logo n'est pas encore modifiable ici
          (stockage dédié à venir) — l'aperçu affiche un monogramme.
        </p>

        <div className="space-y-4">
          <Text label="Nom d'affichage" field="display_name" draft={draft} set={set} errors={fieldErrors} placeholder={orgDisplayName} />
          <Text label="Slogan / sous-titre" field="tagline" draft={draft} set={set} errors={fieldErrors} placeholder="Transit • Logistique • Douane" />

          <div className="grid grid-cols-2 gap-3">
            <Color label="Couleur primaire" field="primary_color" draft={draft} set={set} errors={fieldErrors} fallback={FALLBACK_PRIMARY} />
            <Color label="Couleur secondaire" field="secondary_color" draft={draft} set={set} errors={fieldErrors} fallback={FALLBACK_SECONDARY} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Text label="E-mail de support" field="support_email" draft={draft} set={set} errors={fieldErrors} type="email" placeholder="support@exemple.sn" />
            <Text label="Téléphone de support" field="support_phone" draft={draft} set={set} errors={fieldErrors} placeholder="+221 …" />
          </div>

          <Text label="Pied de page e-mail" field="email_footer" draft={draft} set={set} errors={fieldErrors} />
          <Text label="En-tête PDF" field="pdf_header_text" draft={draft} set={set} errors={fieldErrors} />
          <Text label="Pied de page facture" field="invoice_footer_text" draft={draft} set={set} errors={fieldErrors} />
        </div>

        <p
          ref={statusRef}
          tabIndex={-1}
          aria-live="polite"
          className={`mt-4 min-h-[1.25rem] text-xs font-medium outline-none ${
            status ? (status.tone === "ok" ? "text-emerald-300" : "text-red-400") : "text-transparent"
          }`}
        >
          {status?.message ?? "."}
        </p>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending || !dirty}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty || !validation.ok}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:opacity-40"
          >
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------- preview ---- */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-5" aria-label="Aperçu de la marque">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Aperçu</h2>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">Local · non enregistré</span>
        </div>

        {/* A contained mock tenant surface. Pure presentation from the draft — no data. */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white text-slate-800">
          <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ backgroundColor: primary }}>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
              style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
            >
              {initialsOf(displayName)}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">{displayName}</span>
              {(draft.tagline || "").trim() && <span className="text-[11px] opacity-90">{draft.tagline}</span>}
            </span>
          </header>

          <nav className="flex gap-4 border-b border-slate-200 px-4 py-2 text-xs font-medium" style={{ color: secondary }}>
            <span>Tableau de bord</span>
            <span>Dossiers</span>
            <span>Facturation</span>
          </nav>

          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: primary }}>
                Action principale
              </button>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: secondary }}>
                Statut
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold" style={{ color: secondary }}>Carte d'exemple</p>
              <p className="mt-1 text-[11px] text-slate-500">Titres et accents utilisent vos couleurs de marque.</p>
            </div>
            <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-400">
              {(draft.email_footer || "").trim() || displayName}
              {(draft.support_email || "").trim() ? ` · ${draft.support_email}` : ""}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Aperçu illustratif. La même donnée persistée alimente les e-mails, PDF et le portail du tenant.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------- field bits ----

function fieldError(errors: Partial<Record<EditableBrandingField, BrandingFieldError>>, field: EditableBrandingField): string | null {
  const e = errors[field];
  return e ? FIELD_ERROR_FR[e] : null;
}

function Text({
  label,
  field,
  draft,
  set,
  errors,
  type = "text",
  placeholder,
}: {
  label: string;
  field: EditableBrandingField;
  draft: BrandingDraft;
  set: (f: EditableBrandingField, v: string) => void;
  errors: Partial<Record<EditableBrandingField, BrandingFieldError>>;
  type?: string;
  placeholder?: string;
}) {
  const err = fieldError(errors, field);
  const id = `brand-${field}`;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      <input
        id={id}
        type={type}
        value={draft[field] ?? ""}
        placeholder={placeholder}
        onChange={(e) => set(field, e.target.value)}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        className={`w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-white focus:outline-none ${
          err ? "border-red-500/60 focus:border-red-400" : "border-white/10 focus:border-teal-400"
        }`}
      />
      {err && <span id={`${id}-err`} className="mt-1 block text-[11px] text-red-400">{err}</span>}
    </label>
  );
}

function Color({
  label,
  field,
  draft,
  set,
  errors,
  fallback,
}: {
  label: string;
  field: EditableBrandingField;
  draft: BrandingDraft;
  set: (f: EditableBrandingField, v: string) => void;
  errors: Partial<Record<EditableBrandingField, BrandingFieldError>>;
  fallback: string;
}) {
  const err = fieldError(errors, field);
  const id = `brand-${field}`;
  const value = draft[field] ?? "";
  const swatch = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — sélecteur`}
          value={swatch}
          onChange={(e) => set(field, e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
        />
        <input
          id={id}
          type="text"
          value={value}
          placeholder={fallback}
          onChange={(e) => set(field, e.target.value)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className={`w-full rounded-lg border bg-white/5 px-3 py-2 font-mono text-sm text-white focus:outline-none ${
            err ? "border-red-500/60 focus:border-red-400" : "border-white/10 focus:border-teal-400"
          }`}
        />
      </div>
      {err && <span id={`${id}-err`} className="mt-1 block text-[11px] text-red-400">{err}</span>}
    </label>
  );
}
