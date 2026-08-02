"use client";

/**
 * EC-3C — open a quotation request, then draft version 1.
 *
 * Two server acts in sequence, both gated on `quotation:create`: the request is
 * the commercial thread, the quotation is the offer. The EC-2 handoff, when
 * present, is carried through as `triageItemId` so the correspondence and the
 * request are linked — but only because a human clicked; nothing here fires on
 * its own.
 *
 * The client list is TENANT-SCOPED server-side (`listCommercialClients`). This
 * component cannot widen it, and `createQuotationRequest` re-checks the client
 * belongs to the tenant, so a tampered value is refused rather than trusted.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQuotationRequest, createQuotation } from "@/lib/commercial/actions";

export function NewQuotationForm({
  clients, triageItemId, presetClientId,
}: {
  clients: { id: string; name: string }[];
  triageItemId: string | null;
  presetClientId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(presetClientId ?? "");
  const [subject, setSubject] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const req = await createQuotationRequest({
        clientId, subject: subject || null, reference: reference || null, triageItemId,
      });
      if (!req.ok) {
        setError(req.error === "client_not_found" ? "Client introuvable." : "Enregistrement impossible.");
        return;
      }
      if (!req.id) { setError("Enregistrement impossible."); return; }
      const q = await createQuotation(req.id);
      if (!q.ok || !q.id) {
        setError("La demande est créée, mais le brouillon n'a pas pu être ouvert.");
        router.push("/commercial");
        return;
      }
      router.push(`/commercial/quotations/${q.id}`);
    });
  }

  return (
    <div className="surface space-y-4 p-5">
      {triageItemId ? (
        <p className="rounded-lg bg-sand-100 px-3 py-2 text-sm text-navy-900">
          Cette demande sera liée au courrier entrant orienté vers une cotation.
        </p>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-navy-900">Client</span>
        <select
          className="field"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">— Sélectionner un client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-navy-900">Objet</span>
        <input
          className="field" value={subject} onChange={(e) => setSubject(e.target.value)}
          placeholder="Ex. : transit maritime Dakar — 2 conteneurs 40'"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-navy-900">Référence client (facultatif)</span>
        <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !clientId}
        className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40"
      >
        {pending ? "Création…" : "Créer la demande et le brouillon"}
      </button>
    </div>
  );
}
