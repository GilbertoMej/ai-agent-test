"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import { ApprovalCard, type ApprovalTier } from "./ApprovalCard";
import { AutoApproveToggle } from "./AutoApproveToggle";
import { CostCounter } from "./CostCounter";
import { ActionFeed, type FeedPart } from "./ActionFeed";
import { usePauseOnUnload, loadSessionId, saveSessionId } from "@/app/lib/pause-signal";
import type { ApprovalMode } from "@/worker/src/lib/approval";

// Vercel AI SDK `useChat`. Streams from /api/chat -> worker SSE.
// 01-04 / 01-11 — inline ApprovalCard for write_low + write_high tool calls
// and a header AutoApproveToggle that threads approvalMode into the body.
// 01-08 — header CostCounter aggregates message.usage across the session.
// 01-10 / UI-03 / UI-05 — ActionFeed renders inline bubbles for every tool part;
// TransientAgentError retried 3 times (1s/2s/4s); permanent errors surface toast.

interface ToolApprovalPart {
  type: "tool-call-approval" | string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  tier?: ApprovalTier;
}

// Marks an error as transient — these get retried with backoff. Network errors / 5xx / timeout.
export class TransientAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientAgentError";
  }
}

export function isTransient(err: unknown): boolean {
  if (err instanceof TransientAgentError) return true;
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("network") || m.includes("timeout") || m.includes("5") || m.includes("econn");
}

// 3 attempts at 1s/2s/4s — matches the C1 MCP reconnect ladder.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export async function withTransientRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || attempt === RETRY_DELAYS_MS.length) throw e;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`retry: ${label} attempt=${attempt + 1} delay=${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function ChatPanel() {
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("tiered");
  // 01-F2 — initialize sessionId to a stable empty string so SSR + first client paint
  // produce identical HTML. The real id is loaded (or freshly generated) inside the
  // post-mount useEffect below, which triggers a single re-render.
  // 01-13 / UI-04 — session id persists across refresh via localStorage key `sdlc.playground.session.v1`.
  const [sessionId, setSessionId] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, append } = useChat({
    api: "/api/chat",
    body: { approvalMode, sessionId },
  });

  const [err, setErr] = useState<string | null>(null);

  // 01-13 / D-07 — pause the worker on tab close; SSE reconnect re-emits the same tool-call-approval chunk.
  usePauseOnUnload(sessionId);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const transient = isTransient(e);
      setErr(transient ? `Transient error (will retry): ${e.message}` : e.message);
      if (!transient) setToast(e.message);
    };
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, []);

  // 01-F2 — hydrate sessionId post-mount. SSR + first client paint both render ""
  // (stable), so React 19 sees no hydration mismatch. After mount we either restore
  // the stored id or generate a fresh one and persist it. Empty deps — do NOT add
  // sessionId, otherwise setSessionId would loop the effect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = loadSessionId(); if (existing) { setSessionId(existing); return; }
    const fresh = `sess-${Math.random().toString(36).slice(2, 10)}`; saveSessionId(fresh); setSessionId(fresh);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const decide = async (decision: "approve" | "decline", part: ToolApprovalPart, pattern?: string) => {
    const url = decision === "approve" ? "/api/approve" : "/api/decline";
    try {
      await withTransientRetry(
        () =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args ?? {},
              tier: part.tier,
              pattern,
              sessionId,
            }),
          }),
        `${decision}:${part.toolName}`,
      );
    } catch (e) {
      setToast(`Failed to ${decision}: ${(e as Error).message}`);
      return;
    }
    // Resume: send a follow-up so the agent re-runs the now-approved tool.
    await append({
      role: "user",
      content:
        decision === "approve"
          ? `Continue with ${part.toolName} (approved).`
          : `Skip ${part.toolName} (denied).`,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8b94a7" }}>Session: {sessionId}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <CostCounter messages={messages as unknown as Parameters<typeof CostCounter>[0]["messages"]} />
          <AutoApproveToggle value={approvalMode} onChange={setApprovalMode} />
        </div>
      </div>
      <div
        style={{
          minHeight: 240,
          padding: 12,
          border: "1px solid #2a2f3a",
          borderRadius: 8,
          background: "#161922",
          overflowY: "auto",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#8b94a7", margin: 0 }}>
            Type &quot;hello&quot; (read), &quot;create a note&quot; (write_low), or &quot;apply migrations&quot; (write_high).
          </p>
        )}
        {messages.map((m) => {
          const parts = ((m as unknown as { parts?: unknown[] }).parts ?? []) as FeedPart[];
          return (
            <div
              key={m.id}
              style={{
                padding: "6px 8px",
                margin: "4px 0",
                borderRadius: 6,
                background: m.role === "user" ? "#1f2532" : "#222a3a",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <strong style={{ fontSize: 12, color: "#8b94a7" }}>{m.role}</strong>
              <div style={{ marginTop: 4 }}>
                {m.content}
                <ActionFeed parts={parts} />
                {parts.map((p, i) =>
                  p.type === "tool-call-approval" ? (
                    <ApprovalCard
                      key={`card-${i}`}
                      tier={(p as ToolApprovalPart).tier ?? "write_low"}
                      toolName={p.toolName ?? "unknown"}
                      args={p.args ?? {}}
                      onApprove={() => decide("approve", p as ToolApprovalPart)}
                      onDecline={() => decide("decline", p as ToolApprovalPart)}
                      onApproveAll={(pat) => decide("approve", p as ToolApprovalPart, pat)}
                    />
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>{err}</div>}
      {toast && (
        <div
          role="status"
          style={{
            padding: "6px 10px",
            borderRadius: 4,
            background: "#2a1212",
            border: "1px solid #ff5252",
            color: "#ff8a80",
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="hello / create a note / apply migrations"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #2a2f3a",
            background: "#0f1115",
            color: "#e6e6e6",
          }}
        />
        <button
          type="submit"
          disabled={isLoading}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #3a4256",
            background: isLoading ? "#2a2f3a" : "#3a4256",
            color: "#e6e6e6",
            cursor: isLoading ? "default" : "pointer",
          }}
        >
          {isLoading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
