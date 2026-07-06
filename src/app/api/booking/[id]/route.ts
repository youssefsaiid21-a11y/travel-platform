import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const booking = await db.booking.findUnique({ where: { id } });

  // Same response for "doesn't exist" and "exists but isn't yours" - matches
  // the page route's own documented intent (booking/[id]/page.tsx) that
  // someone probing another user's booking id shouldn't be able to tell
  // the two cases apart.
  if (!booking || booking.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ booking });
}
