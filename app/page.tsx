import { redirect } from "next/navigation";
import { getLandingRoute } from "@/lib/navigation/server";

// The landing route depends on WHO is asking, so this one page must render per
// request. It is a redirect, not content — nothing is lost by not prerendering it,
// and the rest of the app (including /login) still prerenders exactly as before.
export const dynamic = "force-dynamic";

/**
 * The front door. Phase 5.0E-1 (Deliverable 2): this used to send EVERY staff user
 * to /dashboard — including a Coursier, who holds no analytics:read and therefore
 * landed on an empty page. The destination is now a role decision, resolved by one
 * pure function (lib/navigation/landing.ts).
 *
 * A signed-out caller still goes to /login: the middleware and the route contract
 * remain the authority on authentication; this only chooses where a signed-in user
 * starts.
 */
export default async function Home() {
  const landing = await getLandingRoute();
  redirect(landing ?? "/login");
}
