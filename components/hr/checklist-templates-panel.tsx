"use client";

/**
 * HR-8C — « Modèles de check-list » in the configuration center.
 *
 * One panel for the ONE template engine, serving both workspaces: an
 * Intégration model feeds « Nouveau dossier d'intégration », a Départ model
 * feeds « Nouveau départ ». No second checklist system, no new vocabulary,
 * no HR policy invented here — Effitrans writes its own steps.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createChecklistTemplate, updateChecklistTemplate,
  createChecklistItem, updateChecklistItem, deleteChecklistItem,
} from "@/lib/hr/checklist-actions";
import {
  CHECKLIST_KINDS, CHECKLIST_KIND_LABEL_FR,
  type ChecklistKind, type ChecklistTemplate, type ChecklistItemTemplate,
} from "@/lib/hr/checklists/model";

const ERR: Record<string, string> = {
  forbidden: "Vous n'avez pas les droits nécessaires pour gérer les modèles.",
  code_required: "Le code est obligatoire.",
  label_required: "Le libellé est obligatoire.",
  invalid_kind: "Type de modèle invalide.",
  already_exists: "Un modèle porte déjà ce code.",
  not_found: "Modèle ou étape introuvable.",
  item_in_use: "Cette étape a déjà été utilisée dans un dossier : elle ne peut plus être supprimée. Vous pouvez la corriger, ou désactiver le modèle.",
  save_failed: "L'enregistrement a échoué.",
};

type Draft = {
  labelFr: string; responsibleFunction: string;
  isRequired: boolean; isBlocking: boolean; evidenceRequired: boolean; dueOffsetDays: string;
};
const EMPTY_DRAFT: Draft = {
  labelFr: "", responsibleFunction: "",
  isRequired: true, isBlocking: true, evidenceRequired: false, dueOffsetDays: "0",
};

export function ChecklistTemplatesPanel({
  templates, itemsByTemplate,
}: {
  templates: ChecklistTemplate[];
  itemsByTemplate: Record<string, ChecklistItemTemplate[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<ChecklistKind>("ONBOARDING");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else { after?.(); router.refresh(); }
    });
  };

  return (
    <section className="surface space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-navy-900">Modèles de check-list</h2>
        <p className="text-xs text-slate-500">
          Les étapes proposées à l&apos;ouverture d&apos;un dossier d&apos;intégration ou d&apos;un départ.
          Un modèle sert de point de départ : les libellés sont recopiés dans le dossier au moment de
          son ouverture, et modifier un modèle ensuite ne réécrit jamais un dossier existant.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {/* ---- new template -------------------------------------------------- */}
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code (ex. DEPART_STANDARD)"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Code du modèle" />
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Libellé (ex. Clôture de départ)"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Libellé du modèle" />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as ChecklistKind)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type de modèle">
          {CHECKLIST_KINDS.map((k) => <option key={k} value={k}>{CHECKLIST_KIND_LABEL_FR[k]}</option>)}
        </select>
        <button disabled={pending || !newCode.trim() || !newLabel.trim()}
          onClick={() => run(
            () => createChecklistTemplate({ code: newCode, labelFr: newLabel, kind: newKind }),
            () => { setNewCode(""); setNewLabel(""); })}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
          Créer le modèle
        </button>
      </div>

      {/* ---- existing templates -------------------------------------------- */}
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">
          Aucun modèle. Créez-en un pour proposer des étapes à l&apos;ouverture des dossiers ;
          sans modèle, un dossier s&apos;ouvre sans étapes.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => {
            const items = itemsByTemplate[t.id] ?? [];
            const isOpen = open === t.id;
            return (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button onClick={() => setOpen(isOpen ? null : t.id)} className="text-left">
                    <span className="text-sm font-medium text-navy-900">{t.label_fr}</span>
                    <span className="ml-2 text-xs text-slate-400">{t.code}</span>
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {CHECKLIST_KIND_LABEL_FR[t.kind as ChecklistKind] ?? t.kind}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">{items.length} étape(s)</span>
                    {!t.is_active && <span className="ml-2 text-xs text-amber-700">inactif</span>}
                  </button>
                  <span className="flex items-center gap-2">
                    <button disabled={pending} onClick={() => setRenaming({ id: t.id, label: t.label_fr })}
                      className="text-xs text-teal-700 hover:underline">Renommer</button>
                    <button disabled={pending}
                      onClick={() => run(() => updateChecklistTemplate(t.id, { isActive: !t.is_active }))}
                      className="text-xs text-slate-500 hover:underline">
                      {t.is_active ? "Désactiver" : "Réactiver"}
                    </button>
                  </span>
                </div>

                {renaming?.id === t.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={renaming.label} onChange={(e) => setRenaming({ id: t.id, label: e.target.value })}
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Nouveau libellé" />
                    <button disabled={pending || !renaming.label.trim()}
                      onClick={() => run(
                        () => updateChecklistTemplate(t.id, { labelFr: renaming.label }),
                        () => setRenaming(null))}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-teal-300">
                      Enregistrer
                    </button>
                    <button onClick={() => setRenaming(null)} className="text-xs text-slate-500 hover:underline">Annuler</button>
                  </div>
                )}

                {isOpen && (
                  <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-4">
                    {items.length === 0 ? (
                      <p className="text-sm text-slate-500">Aucune étape dans ce modèle.</p>
                    ) : (
                      <ul className="space-y-1">
                        {items.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-slate-700">
                              <span className="text-xs text-slate-400">{i.position}.</span> {i.label_fr}
                              {i.responsible_function && <span className="ml-2 text-xs text-slate-400">{i.responsible_function}</span>}
                              {i.is_blocking && <span className="ml-2 text-xs text-red-600">bloquante</span>}
                              {i.evidence_required && <span className="ml-2 text-xs text-slate-400">pièce requise</span>}
                              {i.due_offset_days !== 0 && (
                                <span className="ml-2 text-xs text-slate-400">
                                  échéance : {i.due_offset_days > 0 ? `+${i.due_offset_days}` : i.due_offset_days} j
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-2">
                              <button disabled={pending} onClick={() => setEditing({ id: i.id, label: i.label_fr })}
                                className="text-xs text-teal-700 hover:underline">Modifier</button>
                              <button disabled={pending}
                                onClick={() => run(() => updateChecklistItem(i.id, { isBlocking: !i.is_blocking }))}
                                className="text-xs text-slate-500 hover:underline">
                                {i.is_blocking ? "Rendre facultative" : "Rendre bloquante"}
                              </button>
                              <button disabled={pending} onClick={() => run(() => deleteChecklistItem(i.id))}
                                className="text-xs text-slate-400 hover:underline">Supprimer</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {editing && items.some((i) => i.id === editing.id) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={editing.label} onChange={(e) => setEditing({ id: editing.id, label: e.target.value })}
                          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Libellé de l'étape" />
                        <button disabled={pending || !editing.label.trim()}
                          onClick={() => run(
                            () => updateChecklistItem(editing.id, { labelFr: editing.label }),
                            () => setEditing(null))}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-teal-300">
                          Enregistrer
                        </button>
                        <button onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:underline">Annuler</button>
                      </div>
                    )}

                    {/* ---- new item ------------------------------------------ */}
                    <div className="grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
                      <input value={draft.labelFr} onChange={(e) => setDraft({ ...draft, labelFr: e.target.value })}
                        placeholder="Nouvelle étape" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                        aria-label="Libellé de la nouvelle étape" />
                      <input value={draft.responsibleFunction} onChange={(e) => setDraft({ ...draft, responsibleFunction: e.target.value })}
                        placeholder="Responsable (facultatif)" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                        aria-label="Fonction responsable" />
                      <input type="number" value={draft.dueOffsetDays} onChange={(e) => setDraft({ ...draft, dueOffsetDays: e.target.value })}
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                        aria-label="Échéance en jours" placeholder="Échéance (jours)" />
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={draft.isBlocking}
                          onChange={(e) => setDraft({ ...draft, isBlocking: e.target.checked })} />
                        Bloquante (empêche la clôture)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" checked={draft.evidenceRequired}
                          onChange={(e) => setDraft({ ...draft, evidenceRequired: e.target.checked })} />
                        Pièce justificative requise
                      </label>
                      <button disabled={pending || !draft.labelFr.trim()}
                        onClick={() => run(
                          () => createChecklistItem({
                            templateId: t.id, labelFr: draft.labelFr,
                            responsibleFunction: draft.responsibleFunction || null,
                            isRequired: draft.isRequired, isBlocking: draft.isBlocking,
                            evidenceRequired: draft.evidenceRequired,
                            dueOffsetDays: Number(draft.dueOffsetDays) || 0,
                          }),
                          () => setDraft(EMPTY_DRAFT))}
                        className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                        Ajouter l&apos;étape
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">
                      Une étape « bloquante » doit être traitée (faite ou sans objet) avant la clôture du dossier.
                      Une étape avec pièce requise se justifie par un document déposé dans le dossier de l&apos;employé.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
