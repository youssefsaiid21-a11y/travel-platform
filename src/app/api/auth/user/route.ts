import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim() ?? "";

  if (name.length > 100) {
    return NextResponse.json(
      { error: "Name must be 100 characters or fewer." },
      { status: 400 }
    );
  }

  const user = await db.user.update({
    where: { id: session.user.id },
    data: { name: name || null },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(user);
}
