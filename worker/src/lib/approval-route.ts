import { nanoid } from "nanoid";
import type { Mastra } from "@mastra/core";
import { db } from "@/db/client";
import { auditLog, approvalGrants } from "@/db/schema";
import { classify } from "./classify";

// 01-04 + 01-11 — /approval/approve and /approval/decline handlers.
// Wired into the worker via apiRoutes in worker/src/index.ts.
// Records audit_log.approval_decision and (for approve with pattern) an
// approval_grants row so resolveApproval() short-circuits for 5 min.

export interface ApprovalPayload {
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  tier?: "read" | "write_low" | "write_high";
  pattern?: string; // when set, writes an approval_grants row
  sessionId?: string;
}

async function recordDecision(
  p: ApprovalPayload,
  decision: "user_allow" | "user_deny" | "auto",
): Promise<void> {
  await db.insert(auditLog).values({
    id: nanoid(),
    session_id: p.sessionId ?? process.env.SESSION_ID ?? "anon",
    tool_name: p.toolName,
    args_json: JSON.stringify(p.args ?? {}),
    result_status: decision === "user_deny" ? "denied" : "ok",
    approval_decision: decision,
    duration_ms: 0,
  });
}

async function writeGrant(pattern: string): Promise<void> {
  await db.insert(approvalGrants).values({
    id: nanoid(),
    pattern,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
}

export function registerApprovalRoutes(mastra: Mastra): void {
  // The Mastra Hono server exposes registered apiRoutes; these handlers
  // piggyback on the same shape (path + handler) the SDK expects.
  // ponytail: hand-rolled handlers — no extra deps, no extra middleware.
  const handlers = {
    approve: async (body: ApprovalPayload) => {
      await recordDecision(body, "user_allow");
      if (body.pattern) await writeGrant(body.pattern);
      return { ok: true, tier: classify(body.toolName) };
    },
    decline: async (body: ApprovalPayload) => {
      await recordDecision(body, "user_deny");
      return { ok: true, tier: classify(body.toolName) };
    },
  };
  // Stash on the mastra instance so the route file in worker/src/index.ts
  // can register them via apiRoutes. Keeps this file a pure-logic module.
  (mastra as unknown as { __approval: typeof handlers }).__approval = handlers;
}

export function getApprovalHandlers(mastra: Mastra) {
  return (mastra as unknown as { __approval?: {
    approve: (b: ApprovalPayload) => Promise<{ ok: true; tier: string }>;
    decline: (b: ApprovalPayload) => Promise<{ ok: true; tier: string }>;
  } }).__approval;
}
