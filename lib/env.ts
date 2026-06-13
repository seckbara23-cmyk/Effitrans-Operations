/**
 * Effitrans Operations Platform — environment validation (fail-fast).
 * ---------------------------------------------------------------------------
 * Validates required environment variables and fails fast with a clear message
 * when one is missing.
 *
 * ⚠️ IMPORTANT: NEXT_PUBLIC_* must be accessed via a STATIC literal key
 * (`process.env.NEXT_PUBLIC_SUPABASE_URL`) so Next.js inlines them into the
 * CLIENT bundle at build time. Dynamic access (`process.env[name]`) is NOT
 * inlined and is `undefined` in the browser — which previously broke the
 * browser Supabase client. Do not refactor these back into a dynamic loop.
 */

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error(
      `[env] Missing required environment variable "${name}". ` +
        `Set it locally (.env, see docs/SETUP.md) or in the Vercel project settings.`,
    );
  }
  return value;
}

export type PublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

export type ServerEnv = PublicEnv & {
  SUPABASE_SERVICE_ROLE_KEY: string;
};

/**
 * Public (client-safe) environment. Safe to call from anywhere.
 * Static property access ensures NEXT_PUBLIC_* are inlined into the client bundle.
 */
export function getPublicEnv(): PublicEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: requireValue(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: requireValue(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/**
 * Server-only environment. MUST be called only from server-side code — the
 * service-role key bypasses RLS and must never reach the client bundle.
 * (DATABASE_URL is intentionally NOT required here: it is used only by the
 * migration CLI, never at runtime.)
 */
export function getServerEnv(): ServerEnv {
  return {
    ...getPublicEnv(),
    SUPABASE_SERVICE_ROLE_KEY: requireValue(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}
