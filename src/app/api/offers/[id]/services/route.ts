import { NextRequest, NextResponse } from "next/server";
import { getOfferWithServices } from "@/lib/duffel/search";
import { DuffelError } from "@/lib/duffel/client";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = await enforceRateLimit(req, "offer-services");
  if (rateLimited) return rateLimited;

  const { id } = await params;

  try {
    const offer = await getOfferWithServices(id);
    return NextResponse.json({ services: offer.services ?? [] });
  } catch (err) {
    if (err instanceof DuffelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load bag & seat options" },
      { status: 500 }
    );
  }
}
