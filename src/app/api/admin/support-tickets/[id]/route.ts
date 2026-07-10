import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/adminAuth";
import { checkRateLimit } from "@/lib/rate-limit";

const VALID_STATUSES = ["open", "resolved"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    const status = admin.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  if (process.env.NODE_ENV !== "test") {
    const rl = await checkRateLimit(`admin-ticket-update:${admin.id}`, { max: 30, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = (body as Record<string, unknown> | null)?.status;

  if (typeof status !== "string" || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const ticket = await db.supportTicket.update({
    where: { id },
    data: { status },
  }).catch(() => null);

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}
