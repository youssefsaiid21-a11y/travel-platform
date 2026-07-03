import { NextRequest, NextResponse } from "next/server";
import { getSeatMap } from "@/lib/duffel/search";
import { DuffelError } from "@/lib/duffel/client";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(req, "offer-seat-map");
  if (rateLimited) return rateLimited;

  const { id } = await params;

  try {
    const seatMaps = await getSeatMap(id);
    return NextResponse.json({ seatMaps });
  } catch (err) {
    if (err instanceof DuffelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load seat map" },
      { status: 500 }
    );
  }
}
