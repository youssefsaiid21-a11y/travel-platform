import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { safeDecryptPassport } from "@/lib/crypto";

// GDPR-style data export - everything this app holds about the signed-in
// user, as a single JSON document they can download.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, passengerProfile, bookings, trackedSearches] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    db.passengerProfile.findUnique({ where: { userId } }),
    db.booking.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.trackedSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    user,
    passengerProfile: passengerProfile
      ? { ...passengerProfile, passportNumber: safeDecryptPassport(passengerProfile.passportNumber) }
      : null,
    bookings,
    trackedSearches,
  });
}
