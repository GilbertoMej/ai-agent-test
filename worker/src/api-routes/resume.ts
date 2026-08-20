import { registerApiRoute } from "@mastra/core/server";
import { isSuspended, clearSuspended, listSuspendedRuns } from "./pause";

// 01-13 / D-07 — worker resume handler. The SSE relay calls this when the
// browser reconnects; the worker re-emits the suspended tool-call-approval
// chunk on the resumed stream with the same toolCallId.

interface ResumePayload {
  sessionId?: string;
}

export const resumeRoute = registerApiRoute("/resume", {
  method: "POST",
  handler: async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as ResumePayload;
    const sessionId = body.sessionId ?? "anon";
    const wasSuspended = isSuspended(sessionId);
    clearSuspended(sessionId);
    return c.json({
      ok: true,
      resumed: wasSuspended,
      suspended: listSuspendedRuns(),
      sessionId,
    });
  },
});

export const suspendedListRoute = registerApiRoute("/suspended", {
  method: "GET",
  handler: async (c) => c.json({ suspended: listSuspendedRuns() }),
});
