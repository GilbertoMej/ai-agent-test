import { registerApiRoute } from "@mastra/core/server";

// 01-13 / D-07 — worker pause handler. Marks the session as suspended so the
// next SSE reconnect can resume the agent loop via listSuspendedRuns.
//
// ponytail: in-memory Map; survives until the worker restarts (PostgresStore
// retains the snapshot, so D-08 covers the restart path).

// UIMessage shape — keep this structural so pause.ts does not import ai's types
// (which would pull the full SDK into a route handler). Cast at the boundary.
interface StoredMessage {
  id?: string;
  role?: string;
  parts?: unknown[];
  metadata?: unknown;
}

interface PausePayload {
  sessionId?: string;
  messages?: StoredMessage[];
}

interface SuspendedRun {
  pausedAt: number;
  messages: StoredMessage[];
}

const suspendedRuns = new Map<string, SuspendedRun>();

export function listSuspendedRuns(): Array<{ sessionId: string; pausedAt: number }> {
  return Array.from(suspendedRuns.entries()).map(([sessionId, v]) => ({ sessionId, pausedAt: v.pausedAt }));
}

export function isSuspended(sessionId: string): boolean {
  return suspendedRuns.has(sessionId);
}

export function clearSuspended(sessionId: string): void {
  suspendedRuns.delete(sessionId);
}

export function getSuspendedMessages(sessionId: string): StoredMessage[] | undefined {
  return suspendedRuns.get(sessionId)?.messages;
}

export const pauseRoute = registerApiRoute("/pause", {
  method: "POST",
  handler: async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PausePayload;
    const sessionId = body.sessionId ?? "anon";
    suspendedRuns.set(sessionId, {
      pausedAt: Date.now(),
      messages: Array.isArray(body.messages) ? body.messages : [],
    });
    return c.json({ ok: true, suspended: true, sessionId });
  },
});
