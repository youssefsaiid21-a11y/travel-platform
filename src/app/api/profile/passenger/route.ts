import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await db.passengerProfile.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json(profile ?? null);
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db.passengerProfile.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { givenName, familyName, bornOn, gender, title, phone, specialRequests } = body;

  if (!givenName || !familyName || !bornOn || !gender || !title || !phone) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }

  const profile = await db.passengerProfile.upsert({
    where: { userId: session.user.id },
    update: { givenName, familyName, bornOn, gender, title, phone, specialRequests: specialRequests ?? null },
    create: { userId: session.user.id, givenName, familyName, bornOn, gender, title, phone, specialRequests: specialRequests ?? null },
  });

  return NextResponse.json(profile);
}
