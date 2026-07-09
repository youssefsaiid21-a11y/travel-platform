import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { db } from "@/lib/db";
import { authorizeCredentials } from "@/lib/authorizeCredentials";

// Re-checked on every session read (not just at sign-in) - a stolen or
// still-valid JWT from before a password change must stop working
// immediately, not linger until it naturally expires. Returning null is
// next-auth's documented signal to invalidate the session and clear the
// cookie (see @auth/core's session action: `token !== null` gates whether
// a session body is ever produced).
export async function verifyTokenVersion(token: JWT): Promise<JWT | null> {
  const dbUser = await db.user.findUnique({
    where: { id: token.id as string },
    select: { tokenVersion: true },
  });
  if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
    return null;
  }
  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Explicit rather than relying on NextAuth's platform auto-detection
  // (which only auto-trusts the host on Vercel) - this app is meant to be
  // portable across hosting providers, not pinned to a single one. Safe
  // here specifically because there's no OAuth provider (only Credentials),
  // so the usual trustHost risk (forged Host header hijacking an OAuth
  // redirect) doesn't apply.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "Two-factor code", type: "text" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tokenVersion = user.tokenVersion;
        return token;
      }
      return verifyTokenVersion(token);
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
});
