#!/usr/bin/env node
// Nightly-only sanity check against the REAL deployed app (Duffel sandbox,
// real Z.AI call) - see CLAUDE.md's Architecture Transformation Roadmap,
// Phase 4. Every other test in this repo mocks Prisma/Duffel/Stripe/the LLM
// client, so this is the only layer that would catch real schema drift in
// either of those two external APIs. Deliberately NOT run per-PR: it's slow,
// costs real (sandbox) API calls, and its failure mode is "an external
// vendor changed something," which a PR author can't fix by editing code.

const APP_URL = process.env.SMOKE_TEST_URL ?? "https://travel-platform-ashy.vercel.app";

function futureDateString(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// Parses the exact SSE format src/app/api/chat/route.ts's `sse()` helper
// produces (`event: <name>\ndata: <json>\n\n`) and returns a named event's
// payload, mirroring the `readSSEEvent` test helper used elsewhere.
function parseSSEEvent(sseText, eventName) {
  const lines = sseText.split("\n");
  let currentEvent = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice("event: ".length).trim();
    } else if (line.startsWith("data: ") && currentEvent === eventName) {
      return JSON.parse(line.slice("data: ".length));
    }
  }
  return null;
}

async function postChat(body) {
  const res = await fetch(`${APP_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Expected a 200 response, got ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Expected an SSE response, got content-type "${contentType}"`);
  }

  return res.text();
}

async function main() {
  const departureDate = futureDateString(60);
  const message = `Flights from London to New York on ${departureDate}`;

  // A valid single-destination search goes through the checkpoint gate
  // first (Phase 3) rather than searching immediately - drive both legs of
  // that round trip, same as a real client (src/app/page.tsx) and the test
  // suite's searchViaCheckpoint() helper do, or this would only ever
  // observe the "checkpoint" event and never reach a real Duffel call.
  const checkpointBody = await postChat({ message });
  const checkpoint = parseSSEEvent(checkpointBody, "checkpoint");
  if (!checkpoint) {
    throw new Error(`No "checkpoint" event in the SSE response:\n${checkpointBody.slice(0, 2000)}`);
  }
  if (!checkpoint.session_id || !checkpoint.params?.origin) {
    throw new Error(`"checkpoint" event has an unexpected shape: ${JSON.stringify(checkpoint)}`);
  }

  const doneBody = await postChat({
    message,
    session_id: checkpoint.session_id,
    confirmed_params: checkpoint.params,
  });
  const done = parseSSEEvent(doneBody, "done");
  if (!done) {
    throw new Error(`No "done" event in the SSE response:\n${doneBody.slice(0, 2000)}`);
  }
  if (!done.session_id) {
    throw new Error(`"done" event is missing session_id: ${JSON.stringify(done)}`);
  }
  if (done.search_failed) {
    throw new Error(`Search reported as failed: "${done.reply}"`);
  }
  if (!Array.isArray(done.offers)) {
    throw new Error(`"offers" is not an array: ${JSON.stringify(done.offers)}`);
  }

  console.log(
    `OK - session ${done.session_id}, ${done.offers.length} offer(s), reply: "${(done.reply ?? "").slice(0, 100)}"`
  );
}

main().catch((err) => {
  console.error("Smoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
