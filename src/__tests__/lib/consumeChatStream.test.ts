import { describe, it, expect, vi } from "vitest";
import { consumeChatStream } from "@/lib/chat/consumeChatStream";

function sseChunk(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Simulates the real fetch Response shape consumeChatStream reads from,
// splitting the full SSE text across multiple `read()` calls (mid-line, in
// the "split" case) to exercise the same partial-chunk buffering a real
// network stream would produce.
function makeSSEResponse(fullText: string, splitAt?: number): Response {
  const encoder = new TextEncoder();
  const chunks =
    splitAt === undefined
      ? [fullText]
      : [fullText.slice(0, splitAt), fullText.slice(splitAt)];

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream);
}

describe("consumeChatStream", () => {
  it("dispatches status, reply_token, checkpoint, and done events to their handlers", async () => {
    const text =
      sseChunk("status", { step: "parsing", message: "Understanding…" }) +
      sseChunk("reply_token", { delta: "Hello" }) +
      sseChunk("checkpoint", {
        session_id: "s1",
        params: { origin: "LHR", destination: "JFK", departure_date: "2026-09-01", passengers: [] },
      }) +
      sseChunk("done", { session_id: "s1", offers: [], reply: "done", search_params: null });

    const onStatus = vi.fn();
    const onReplyToken = vi.fn();
    const onCheckpoint = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await consumeChatStream(makeSSEResponse(text), {
      onStatus,
      onReplyToken,
      onCheckpoint,
      onDone,
      onError,
    });

    expect(onStatus).toHaveBeenCalledWith("parsing", "Understanding…");
    expect(onReplyToken).toHaveBeenCalledWith("Hello");
    expect(onCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "s1",
        params: expect.objectContaining({ origin: "LHR", destination: "JFK" }),
      })
    );
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "s1", reply: "done" })
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("dispatches error events", async () => {
    const text = sseChunk("error", { message: "Something broke" });
    const onError = vi.fn();

    await consumeChatStream(makeSSEResponse(text), { onError });

    expect(onError).toHaveBeenCalledWith("Something broke");
  });

  it("handles an SSE event split across multiple stream reads", async () => {
    const text = sseChunk("done", { session_id: "s2", offers: [], reply: "ok", search_params: null });
    const onDone = vi.fn();

    // Split partway through the "data: " line itself - the parser must
    // buffer the incomplete line rather than dropping or misparsing it.
    await consumeChatStream(makeSSEResponse(text, Math.floor(text.length / 2)), { onDone });

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ session_id: "s2" }));
  });

  it("throws when the response has no body", async () => {
    const res = new Response(null, { status: 500 });
    await expect(consumeChatStream(res, {})).rejects.toThrow("HTTP 500");
  });

  it("silently ignores events with no handler registered", async () => {
    const text = sseChunk("status", { step: "parsing", message: "x" }) + sseChunk("done", { reply: "ok" });
    await expect(consumeChatStream(makeSSEResponse(text), {})).resolves.toBeUndefined();
  });
});
