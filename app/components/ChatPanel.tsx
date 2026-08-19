"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import { ApprovalCard, type ApprovalTier } from "./ApprovalCard";
import { AutoApproveToggle } from "./AutoApproveToggle";
import type { ApprovalMode } from "@/worker/src/lib/approval";

// Vercel AI SDK `useChat`. Streams from /api/chat -> worker SSE.
// 01-04 / 01-11 — inline ApprovalCard for write_low + write_high tool calls
// and a header AutoApproveToggle that threads approvalMode into the body.

interface ToolApprovalPart {
  type: "tool-call-approval" | string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  tier?: ApprovalTier;
}

export function ChatPanel() {
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("tiered");
  const [sessionId] = useState(() => `sess-${Math.random().toString(36).slice(2, 10)}`);

  const { messages, input, handleInputChange, handleSubmit, isLoading, append } = useChat({
    api: "/api/chat",
    body: { approvalMode, sessionId },
  });

  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onError = (e: ErrorEvent) => setErr(e.message);
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, []);

  const decide = async (decision: "approve" | "decline", part: ToolApprovalPart, pattern?: string) => {
    const url = decision === "approve" ? "/api/approve" : "/api/decline";
    await fetch(url, {
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
    });
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
        <AutoApproveToggle value={approvalMode} onChange={setApprovalMode} />
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
        {messages.map((m) => (
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
              {(m as unknown as { parts?: ToolApprovalPart[] }).parts?.map((p, i) =>
                p.type === "tool-call-approval" ? (
                  <ApprovalCard
                    key={i}
                    tier={p.tier ?? "write_low"}
                    toolName={p.toolName ?? "unknown"}
                    args={p.args ?? {}}
                    onApprove={() => decide("approve", p)}
                    onDecline={() => decide("decline", p)}
                    onApproveAll={(pat) => decide("approve", p, pat)}
                  />
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>{err}</div>}
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
