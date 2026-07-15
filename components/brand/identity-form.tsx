"use client";

/**
 * Brand identity editor (DBC-1). CLIENT.
 * ---------------------------------------------------------------------------
 * Edits tenant_brand_profile via the gated updateBrandProfile action. Holds no
 * authority; the action re-validates + re-authorizes. Colors stay blank until the Brand
 * Book supplies them (never invented); fonts are an allowlist; the whistleblower URL is an
 * admin field (https-only), never shown as public text.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBrandProfile, type BrandProfileInput } from "@/lib/brand/server/actions";
import { BRAND_FONTS, LOCKED_BRAND_DEFAULTS } from "@/lib/brand/model";
import type { BrandProfile } from "@/lib/brand/server/service";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ERR_FR: Record<string, string> = {
  invalid_color: "Couleur hexadécimale invalide (ex. #0F766E).",
  invalid_font: "Police non autorisée.",
  invalid_https_url: "URL invalide (https requis).",
  invalid_text: "Les chevrons < > ne sont pas autorisés.",
  forbidden: "Action non autorisée.",
  write_failed: "Échec de l'enregistrement.",
};

export function BrandIdentityForm({ profile }: { profile: BrandProfile }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; msg: string } | null>(null);
  const [d, setD] = useState<BrandProfileInput>({
    color_green: profile.colorGreen ?? "", color_gold: profile.colorGold ?? "", color_anthracite: profile.colorAnthracite ?? "",
    font_heading: profile.fontHeading ?? "", font_body: profile.fontBody ?? "", font_email_fallback: profile.fontEmailFallback ?? "",
    slogan: profile.slogan ?? "", value_proposition: profile.valueProposition ?? "", website_url: profile.websiteUrl ?? "",
    linkedin_url: profile.linkedinUrl ?? "", address: profile.address ?? "", legal_identifiers: profile.legalIdentifiers ?? "",
    whistleblower_url: profile.whistleblowerUrl ?? "",
  });

  const set = (k: keyof BrandProfileInput, v: string) => { setStatus(null); setD((p) => ({ ...p, [k]: v })); };
  const colorBad = (v?: string) => Boolean(v && v.trim() && !HEX_RE.test(v.trim()));

  function save() {
    setStatus(null);
    start(async () => {
      const res = await updateBrandProfile(d);
      if (res.ok) { setStatus({ tone: "ok", msg: "Identité de marque enregistrée." }); router.refresh(); }
      else setStatus({ tone: "error", msg: ERR_FR[res.error] ?? "Échec." });
    });
  }

  return (
    <div className="space-y-6">
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Palette de marque</h2>
        <p className="mt-1 text-xs text-slate-500">Vert, Or et Anthracite — <strong>fournis par la Direction</strong>. Le blanc est défini par les modèles.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Color label="Vert Effitrans" k="color_green" v={d.color_green} set={set} bad={colorBad(d.color_green)} />
          <Color label="Or Effitrans" k="color_gold" v={d.color_gold} set={set} bad={colorBad(d.color_gold)} />
          <Color label="Anthracite" k="color_anthracite" v={d.color_anthracite} set={set} bad={colorBad(d.color_anthracite)} />
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Typographie</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Font label="Titres" k="font_heading" v={d.font_heading} set={set} />
          <Font label="Corps" k="font_body" v={d.font_body} set={set} />
          <Font label="Repli Outlook" k="font_email_fallback" v={d.font_email_fallback} set={set} />
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Identité d'entreprise</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Text label="Slogan" k="slogan" v={d.slogan} set={set} placeholder="Performance in Motion" />
          <Text label="Proposition de valeur" k="value_proposition" v={d.value_proposition} set={set} />
          <Text label="Site web" k="website_url" v={d.website_url} set={set} placeholder="https://www.effitrans.com" />
          <Text label="LinkedIn" k="linkedin_url" v={d.linkedin_url} set={set} />
          <Text label="Adresse" k="address" v={d.address} set={set} />
          <Text label="Identifiants légaux (RC / NINEA)" k="legal_identifiers" v={d.legal_identifiers} set={set} />
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Conformité & durabilité</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Text label="URL du portail de signalement (https, jamais affichée)" k="whistleblower_url" v={d.whistleblower_url} set={set} placeholder="https://…" />
        </div>
        <p className="mt-3 text-xs text-slate-500">Textes verrouillés par défaut (modifiables ultérieurement) : « {LOCKED_BRAND_DEFAULTS.compliance_title} », « {LOCKED_BRAND_DEFAULTS.sustainability_statement} », « {LOCKED_BRAND_DEFAULTS.footer_line} ».</p>
      </section>

      <div className="flex items-center justify-end gap-3">
        {status && <p aria-live="polite" className={`text-sm font-medium ${status.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{status.msg}</p>}
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

function fieldCls(bad?: boolean) {
  return `w-full rounded-lg border bg-white px-3 py-2 text-sm text-navy-900 focus:outline-none ${bad ? "border-red-400 focus:border-red-500" : "border-slate-200 focus:border-teal-500"}`;
}

function Color({ label, k, v, set, bad }: { label: string; k: keyof BrandProfileInput; v?: string; set: (k: keyof BrandProfileInput, v: string) => void; bad: boolean }) {
  const swatch = v && HEX_RE.test(v) ? v : "#ffffff";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} sélecteur`} value={swatch} onChange={(e) => set(k, e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-slate-200" />
        <input value={v ?? ""} onChange={(e) => set(k, e.target.value)} placeholder="À fournir" aria-invalid={bad || undefined} className={`${fieldCls(bad)} font-mono`} />
      </div>
      {bad && <span className="mt-1 block text-[11px] text-red-600">Hex invalide.</span>}
    </label>
  );
}

function Font({ label, k, v, set }: { label: string; k: keyof BrandProfileInput; v?: string; set: (k: keyof BrandProfileInput, v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select value={v ?? ""} onChange={(e) => set(k, e.target.value)} className={fieldCls(false)}>
        <option value="">— Non défini —</option>
        {BRAND_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </label>
  );
}

function Text({ label, k, v, set, placeholder }: { label: string; k: keyof BrandProfileInput; v?: string; set: (k: keyof BrandProfileInput, v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input value={v ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={fieldCls(false)} />
    </label>
  );
}
