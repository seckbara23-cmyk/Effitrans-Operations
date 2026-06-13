/**
 * Effitrans Operations Platform — environment validation (fail-fast stub)
 * ---------------------------------------------------------------------------
 * Wave 0 (S0-INF-1). Validates that required environment variables are present
 * and fails fast with a clear message when one is missing. This is a STUB:
 * no business logic, no Supabase client construction, no auth/RBAC/RLS here.
 *
 * The Supabase clients (lib/supabase/*) are wired in a later wave and will
 * consume these values; this module only guards their presence.
 * ---------------------------------------------------------------------------
 */

/** Variables required for the foundation to boot. Extended in later waves. */
const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** Server-only variables — never referenced from client components. */
const REQUIRED_SERVER_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

type RequiredEnv = (typeof REQUIRED_ENV)[number];
type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number];

function read(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `[env] Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill it in (see docs/SETUP.md).`,
    );
  }
  return value;
}

/**
 * Validate and return the public (client-safe) environment.
 * Safe to call from anywhere.
 */
export function getPublicEnv(): Record<RequiredEnv, string> {
  return REQUIRED_ENV.reduce(
    (acc, name) => {
      acc[name] = read(name);
      return acc;
    },
    {} as Record<RequiredEnv, string>,
  );
}

/**
 * Validate and return server-only environment.
 * MUST be called only from server-side code — these values bypass RLS / are
 * privileged and must never reach the client bundle.
 */
export function getServerEnv(): Record<RequiredEnv | RequiredServerEnv, string> {
  const server = REQUIRED_SERVER_ENV.reduce(
    (acc, name) => {
      acc[name] = read(name);
      return acc;
    },
    {} as Record<RequiredServerEnv, string>,
  );
  return { ...getPublicEnv(), ...server };
}
