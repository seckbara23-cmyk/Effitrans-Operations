/**
 * Copilot provider UX (Phase 3.4F-3) — PURE, client + server safe. No I/O.
 * ---------------------------------------------------------------------------
 * Provider-aware French error messages (D1) and the provider display label +
 * tier (D3). Kept dependency-free and server-import-free so BOTH the API route
 * (error text) and the client panel (provider badge) can use it. Contains no
 * secrets — only the provider name + model tag (already non-sensitive).
 */

export type ProviderTier = "local" | "cloud" | "enterprise";

/** Prettify an Ollama-style model tag: "qwen2.5:3b" → "Qwen2.5 3B". */
export function prettyModel(model: string): string {
  const m = (model ?? "").trim();
  if (!m) return "";
  const [base, size] = m.split(":");
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return size ? `${cap} ${size.toUpperCase()}` : cap;
}

/** Display label + tier for the provider badge ("Qwen2.5 3B" • Local). */
export function providerDisplay(provider: string | null, model: string | null): { label: string; tier: ProviderTier } {
  switch ((provider ?? "").trim()) {
    case "ollama":
      return { label: prettyModel(model ?? "") || "Local", tier: "local" };
    case "vllm":
      return { label: "vLLM", tier: "enterprise" };
    case "openai":
      return { label: "OpenAI", tier: "cloud" };
    default:
      return { label: (provider ?? "IA").trim() || "IA", tier: "cloud" };
  }
}

/**
 * Provider-aware French error message for a Copilot failure code. `code` is the
 * CopilotError code (kept as a plain string to avoid importing the server-only
 * engine). Falls back to a safe generic message for unknown codes.
 */
export function copilotErrorMessage(code: string, ctx: { provider: string | null; model: string | null }): string {
  const provider = (ctx.provider ?? "").trim();
  const model = (ctx.model ?? "").trim();

  switch (code) {
    case "provider_unavailable":
      if (provider === "ollama") return "L'assistant IA local n'est pas disponible. Vérifiez qu'Ollama est en cours d'exécution.";
      if (provider === "vllm") return "L'assistant IA (vLLM) n'est pas disponible. Vérifiez que le service est en cours d'exécution.";
      return "Le fournisseur IA est indisponible ou désactivé sur cet environnement.";
    case "invalid_model":
      if (provider === "ollama") {
        return model
          ? `Le modèle IA « ${model} » n'est pas installé.\nInstallez-le avec : ollama pull ${model}`
          : "Le modèle IA local n'est pas installé.";
      }
      return "Modèle IA invalide ou indisponible. Vérifiez la configuration du modèle.";
    case "timeout":
      if (provider === "ollama" || provider === "vllm") {
        return "L'assistant prend plus de temps que prévu (le modèle démarre peut-être). Réessayez dans quelques instants.";
      }
      return "L'assistant prend plus de temps que prévu. Réessayez dans quelques instants.";
    case "rate_limited":
      // The rate-limit wording is only meaningful for the hosted OpenAI provider.
      if (provider === "openai") return "Limite de requêtes du fournisseur IA atteinte. Réessayez dans un instant.";
      return "Trop de requêtes simultanées. Réessayez dans un instant.";
    case "missing_api_key":
      if (provider === "openai") return "Copilote non configuré : clé API OpenAI manquante (OPENAI_API_KEY).";
      return "Copilote non configuré : authentification du fournisseur IA manquante.";
    case "invalid_api_key":
      return "Authentification du fournisseur IA refusée. Vérifiez la clé.";
    case "empty_response":
      return "Le modèle n'a renvoyé aucune réponse. Réessayez.";
    case "invalid_config":
      return "Configuration IA invalide (fournisseur, modèle ou URL).";
    case "unsafe_config":
      return "Configuration IA refusée sur cet environnement (URL locale ou HTTP non sécurisé en production).";
    case "prompt_too_large":
      return "La requête est trop volumineuse pour le modèle. Raccourcissez votre question.";
    case "upstream_error":
    default:
      return "Le service IA a renvoyé une erreur. Réessayez plus tard.";
  }
}
