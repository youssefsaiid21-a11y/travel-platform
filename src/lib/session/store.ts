import type { NormalizedOffer } from "@/lib/duffel/types";
import type { ConversationMessage, SearchParams } from "@/lib/parser/types";
import { db } from "@/lib/db";

export interface Session {
  id: string;
  last_params: SearchParams | null;
  last_offers: NormalizedOffer[];
  history: ConversationMessage[];
}

// In-process cache - avoids a DB round-trip on every request for hot sessions
const cache = new Map<string, Session>();

export async function getOrCreate(id?: string): Promise<Session> {
  if (id) {
    const hit = cache.get(id);
    if (hit) return hit;

    // Cache miss: hydrate from DB (survives server restarts)
    try {
      const row = await db.chatSession.findUnique({ where: { id } });
      if (row) {
        const session = JSON.parse(row.sessionData) as Session;
        cache.set(id, session);
        return session;
      }
    } catch {
      // DB unavailable - fall through to create a fresh session
    }
  }

  const session: Session = {
    id: id ?? crypto.randomUUID(),
    last_params: null,
    last_offers: [],
    history: [],
  };
  cache.set(session.id, session);
  return session;
}

const HISTORY_LIMIT = 20;
const OFFERS_LIMIT = 30;

export async function save(session: Session): Promise<void> {
  if (session.history.length > HISTORY_LIMIT) {
    session.history = session.history.slice(-HISTORY_LIMIT);
  }
  if (session.last_offers.length > OFFERS_LIMIT) {
    session.last_offers = session.last_offers.slice(0, OFFERS_LIMIT);
  }
  cache.set(session.id, session);

  // Persist async - fire-and-forget; cache still serves if DB fails
  db.chatSession
    .upsert({
      where: { id: session.id },
      create: { id: session.id, sessionData: JSON.stringify(session) },
      update: { sessionData: JSON.stringify(session) },
    })
    .catch(() => {});

  // 1% chance per save: prune sessions older than 7 days
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    db.chatSession.deleteMany({ where: { updatedAt: { lt: cutoff } } }).catch(() => {});
  }
}
