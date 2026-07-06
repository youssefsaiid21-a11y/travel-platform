import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { passengerDocFieldFormatError } from "@/lib/passengerValidation";

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
  const {
    givenName, familyName, bornOn, gender, title, phone, specialRequests,
    nationality, passportNumber, passportExpiry,
  } = body;

  if (!givenName || !familyName || !bornOn || !gender || !title || !phone) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }

  const docFormatError = passengerDocFieldFormatError({ nationality, passportExpiry });
  if (docFormatError) {
    return NextResponse.json({ error: docFormatError }, { status: 400 });
  }

  // Passport/nationality are nullable at this layer (a profile saved before
  // this field existed, or before the user has entered them, is still a
  // valid partial save) - the booking flow itself enforces they're present
  // before an order can actually be placed.
  const data = {
    givenName, familyName, bornOn, gender, title, phone,
    specialRequests: specialRequests ?? null,
    nationality: nationality ?? null,
    passportNumber: passportNumber ?? null,
    passportExpiry: passportExpiry ?? null,
  };

  const profile = await db.passengerProfile.upsert({
    where: { userId: session.user.id },
    update: data,
    create: { userId: session.user.id, ...data },
  });

  return NextResponse.json(profile);
}
