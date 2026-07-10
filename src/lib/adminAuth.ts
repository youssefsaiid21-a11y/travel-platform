import { auth } from "@/auth";
import { db } from "@/lib/db";

export type AdminAuthResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

// The JWT's isAdmin claim (see src/auth.ts) is refreshed on essentially
// every request via verifyTokenVersion's existing DB read, but a demoted
// admin's already-issued JWT could still say isAdmin: true until that read
// runs again - this re-checks the DB directly for the routes/pages that
// actually gate a privileged action, as defense-in-depth. src/proxy.ts's
// gate on /admin/* is the cheap first line of defense, not the only one.
// Distinguishes "not logged in" from "logged in but not admin" so callers
// can return 401 vs 403 rather than collapsing both into one status.
export async function requireAdmin(): Promise<AdminAuthResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauthenticated" };
  if (!session.user.isAdmin) return { ok: false, reason: "forbidden" };

  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!dbUser?.isAdmin) return { ok: false, reason: "forbidden" };

  return { ok: true, id: session.user.id };
}
