import type { ChatResponse, CheckpointEvent } from "@/app/api/chat/route";

export interface ChatStreamHandlers {
  onStatus?: (step: string, message: string) => void;
  onReplyToken?: (delta: string) => void;
  onCheckpoint?: (event: CheckpointEvent) => void;
  onDone?: (body: ChatResponse) => void;
  onError?: (message: string) => void;
}

// Shared SSE-parsing loop for the chat route's response - used by both a
// fresh message send and a "confirm search" resume, which differ only in
// what they do with each event (append a new message vs. update an
// existing one in place), not in how the stream itself is parsed.
export async function consumeChatStream(res: Response, handlers: ChatStreamHandlers): Promise<void> {
  if (!res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let evt = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        evt = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

        if (evt === "status") {
          handlers.onStatus?.((data.step as string) ?? "", (data.message as string) ?? "");
        } else if (evt === "reply_token") {
          handlers.onReplyToken?.((data.delta as string) ?? "");
        } else if (evt === "checkpoint") {
          handlers.onCheckpoint?.(data as unknown as CheckpointEvent);
        } else if (evt === "done") {
          handlers.onDone?.(data as unknown as ChatResponse);
        } else if (evt === "error") {
          handlers.onError?.((data.message as string) ?? "Something went wrong.");
        }

        evt = "";
      }
    }
  }
}
