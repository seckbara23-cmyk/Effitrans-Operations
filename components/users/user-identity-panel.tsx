"use client";

/**
 * « Identité et profil professionnel » — editable from Administration → Users.
 * ---------------------------------------------------------------------------
 * ADMIN-USER-IDENTITY-01. This is the answer to the ratified complaint: a System
 * Administrator had no way to change a staff member's name or professional title
 * from the Users area at all. `lib/users/actions.ts` had create, suspend,
 * archive, restore, assign role, revoke role and the password levers — and no
 * update. The only editor for a job title was the Digital Branding Center, which
 * is exactly where an administrator should NOT have to go to correct somebody's
 * name.
 *
 * ── PROFESSIONAL IDENTITY IS NOT AUTHORITY, AND THE LAYOUT SAYS SO ──────────
 * Three sections, deliberately separated, because putting « Titre principal »
 * next to « Rôle » invites the reading that one implies the other:
 *
 *     IDENTITÉ                 who they are        editable
 *     PROFIL PROFESSIONNEL     what they do        editable
 *     ACCÈS ET AUTORISATIONS   what they may do    READ-ONLY here
 *
 * Setting a title of « Chef de Transit » grants nothing. Roles are managed in
 * the directory, by their own capability, and this component neither reads nor
 * writes them — it displays them so an administrator can see the two facts side
 * by side and tell them apart.
 *
 * ── AND IT NEVER PRETENDS TO SAVE WHAT IT CANNOT ────────────────────────────
 * `storable` is the server's answer to « is migration 20261003000001 applied ».
 * While it is false the platform genuinely cannot hold a first/last split or a
 * fonction, so those inputs are NOT rendered — and a sentence says why, rather
 * than leaving an administrator to conclude the feature was never built. What IS
 * offered on schema 138 is real and persists: the display name and the titre
 * principal, the latter into the very column the Digital Business Card reads.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserIdentity } from "@/lib/users/actions";
import { SUGGESTED_FUNCTIONS, type StaffIdentity } from "@/lib/users/identity";
import type { ActionResult } from "@/lib/users/types";
import { t } from "@/lib/i18n";

const ERROR_FR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de modifier ce profil.",
  not_found: "Utilisateur introuvable.",
  user_archived: "Cet utilisateur est archivé : restaurez-le avant de modifier son profil.",
  invalid_identity:
    "Valeurs invalides : chaque champ est limité à 120 caractères, et le nom complet ne peut pas être envoyé en même temps que le prénom et le nom.",
  identity_schema_unavailable:
    "Le prénom, le nom et la fonction ne peuvent pas encore être enregistrés : la migration 20261003000001 n'est pas appliquée. Rien n'a été enregistré.",
  generic: "L'enregistrement a échoué. Réessayez.",
};

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-500";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function UserIdentityPanel({
  userId,
  email,
  identity,
  storable,
  canUpdate,
  archived,
  roles,
  statusLabel,
}: {
  userId: string;
  email: string;
  identity: StaffIdentity;
  /** Server-resolved: can the platform store a first/last split and a fonction? */
  storable: boolean;
  canUpdate: boolean;
  archived: boolean;
  roles: { roleId: string; code: string; labelFr: string | null }[];
  statusLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [firstName, setFirstName] = useState(identity.firstName ?? "");
  const [lastName, setLastName] = useState(identity.lastName ?? "");
  const [displayName, setDisplayName] = useState(identity.displayName);
  const [functionLabel, setFunctionLabel] = useState(identity.functionLabel ?? "");
  const [mainTitle, setMainTitle] = useState(identity.mainTitle ?? "");

  const editable = canUpdate && !archived;

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      // Only what CHANGED is sent. An untouched field stays `undefined`, which
      // the action reads as « leave it alone » — that is §11's « preserve
      // untouched values », enforced at the wire rather than by re-writing
      // everything and hoping the values match.
      const patch: Parameters<typeof updateUserIdentity>[1] = {};
      if (storable) {
        if (firstName !== (identity.firstName ?? "")) patch.firstName = firstName;
        if (lastName !== (identity.lastName ?? "")) patch.lastName = lastName;
        if (functionLabel !== (identity.functionLabel ?? "")) patch.functionLabel = functionLabel;
      } else if (displayName !== identity.displayName) {
        patch.displayName = displayName;
      }
      if (mainTitle !== (identity.mainTitle ?? "")) patch.mainTitle = mainTitle;

      if (Object.keys(patch).length === 0) {
        setError("Aucune modification à enregistrer.");
        return;
      }

      const res: ActionResult = await updateUserIdentity(userId, patch);
      if (!res.ok) {
        setError(ERROR_FR[res.error] ?? ERROR_FR.generic);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="surface space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold text-navy-900">Identité et profil professionnel</h2>
        <p className="mt-1 text-xs text-slate-600">
          Ces informations décrivent la personne et son métier. Elles alimentent
          l&apos;annuaire, la carte de visite numérique et la signature e-mail.{" "}
          <strong className="font-semibold">
            Elles n&apos;accordent aucun droit : le rôle et les permissions se gèrent séparément.
          </strong>
        </p>
      </div>

      {/* ---------------------------------------------------------- IDENTITÉ */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Identité</p>
        {storable ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prénom">
              <input
                className={input}
                value={firstName}
                maxLength={120}
                disabled={!editable || pending}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </Field>
            <Field label="Nom">
              <input
                className={input}
                value={lastName}
                maxLength={120}
                disabled={!editable || pending}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Field>
            <p className="text-[11px] text-slate-500 sm:col-span-2">
              Nom affiché : <strong className="text-navy-800">{[firstName, lastName].filter(Boolean).join(" ") || identity.displayName}</strong>{" "}
              — composé automatiquement à partir du prénom et du nom.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Field
              label="Nom complet"
              hint="Nom affiché dans l'annuaire, sur la carte de visite et dans la signature."
            >
              <input
                className={input}
                value={displayName}
                maxLength={120}
                disabled={!editable || pending}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
              <strong>Prénom et Nom séparés — pas encore disponibles.</strong> La
              migration <code>20261003000001</code> n&apos;est pas appliquée sur cette
              base. Le nom se saisit donc en un seul champ, et il est réellement
              enregistré. Aucune donnée n&apos;est perdue : le prénom et le nom séparés
              seront proposés dès que la migration sera approuvée.
            </p>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Adresse de connexion : <span className="font-mono">{email}</span> — non modifiable ici.
        </p>
      </div>

      {/* ------------------------------------------- PROFIL PROFESSIONNEL */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Profil professionnel
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {storable ? (
            <Field label="Fonction" hint="Le métier exercé — par exemple Transit, Douane, Finance.">
              <input
                className={input}
                list="effitrans-functions"
                value={functionLabel}
                maxLength={120}
                disabled={!editable || pending}
                onChange={(e) => setFunctionLabel(e.target.value)}
              />
              <datalist id="effitrans-functions">
                {SUGGESTED_FUNCTIONS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
              <strong>Fonction — pas encore disponible.</strong> Même migration
              (<code>20261003000001</code>). Le champ n&apos;est pas affiché plutôt que
              proposé et ignoré.
            </div>
          )}
          <Field
            label="Titre principal"
            hint="La désignation professionnelle — par exemple Chef de Transit, Déclarant en Douane."
          >
            <input
              className={input}
              value={mainTitle}
              maxLength={120}
              disabled={!editable || pending}
              onChange={(e) => setMainTitle(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">
          Le titre principal est celui qu&apos;utilisent la carte de visite numérique et la
          signature e-mail. Il n&apos;y a qu&apos;une seule valeur : la modifier ici la
          modifie partout.
        </p>
      </div>

      {/* --------------------------------------- ACCÈS ET AUTORISATIONS */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Accès et autorisations
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Statut :</span>
          <span className="font-medium text-navy-900">{statusLabel}</span>
          <span className="ml-2 text-slate-500">Rôle(s) :</span>
          {roles.length === 0 && <span className="text-slate-400">{t.common.none}</span>}
          {roles.map((r) => (
            <span key={r.roleId} className="rounded-md bg-white px-2 py-0.5 text-navy-800 ring-1 ring-slate-200">
              {r.labelFr ?? r.code}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          Les rôles se modifient depuis la liste des utilisateurs. Changer une fonction ou
          un titre ci-dessus ne modifie ni le rôle, ni les permissions, ni les affectations
          en cours.
        </p>
      </div>

      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      {saved && !error && (
        <p className="text-xs text-teal-700" role="status">
          Profil enregistré.
        </p>
      )}

      {editable && (
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      )}
      {!canUpdate && (
        <p className="text-xs text-slate-500">
          Consultation seule — la modification requiert l&apos;autorisation
          d&apos;administration des utilisateurs.
        </p>
      )}
      {canUpdate && archived && (
        <p className="text-xs text-slate-500">
          Utilisateur archivé : restaurez-le pour modifier son profil.
        </p>
      )}
    </section>
  );
}
