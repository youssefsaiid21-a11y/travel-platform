import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCronSecret } from "@/lib/cronAuth";

// ChatSession has no per-user ownership and no TTL - a conversation is
// created/continued purely by knowing its id (see CLAUDE.md's Architecture
// Transformation Roadmap), so the table grows unbounded from both normal
// use and any anonymous-endpoint abuse. This doesn't fix the ownership gap
// (a separate, larger product question about whether /api/chat should
// require auth), just the unbounded-growth part: delete sessions that
// haven't been touched in 30 days.
const STALE_AFTER_DAYS = 30;

export async function POST(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await db.chatSession.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  return NextResponse.json({ deleted: count });
}
