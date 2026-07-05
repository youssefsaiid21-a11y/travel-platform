import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const { GET } = handlers;

// Only the credentials callback actually checks a password (brute-force
// surface) - session/csrf/providers GETs and other POST paths shouldn't
// share this budget.
export async function POST(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith("/callback/credentials")) {
    const rateLimited = enforceRateLimit(req, "login");
    if (rateLimited) return rateLimited;
  }
  return handlers.POST(req);
}
