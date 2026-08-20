import { registerApiRoute } from "@mastra/core/server";

// 01-13 / D-07 — worker pause handler. Marks the session as suspended so the
// next SSE reconnect can resume the agent loop via listSuspendedRuns.
//
// ponytail: in-memory Map; survives until the worker restarts (PostgresStore
// retains the snapshot, so D-08 covers the restart path).

interface PausePayload {
  sessionId?: string;
}

const suspendedRuns = new Map<string, { pausedAt: number }>();

export function listSuspendedRuns(): Array<{ sessionId: string; pausedAt: number }> {
  return Array.from(suspendedRuns.entries()).map(([sessionId, v]) => ({ sessionId, ...v }));
}

export function isSuspended(sessionId: string): boolean {
  return suspendedRuns.has(sessionId);
}

export function clearSuspended(sessionId: string): void {
  suspendedRuns.delete(sessionId);
}

export const pauseRoute = registerApiRoute("/pause", {
  method: "POST",
  handler: async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PausePayload;
    const sessionId = body.sessionId ?? "anon";
    suspendedRuns.set(sessionId, { pausedAt: Date.now() });
    return c.json({ ok: true, suspended: true, sessionId });
  },
});
