"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { ApprovalCard, type ApprovalTier } from "./ApprovalCard";
import { AutoApproveToggle } from "./AutoApproveToggle";
import { CostCounter } from "./CostCounter";
import { ActionFeed, type FeedPart } from "./ActionFeed";
import { usePauseOnUnload, loadSessionId, saveSessionId } from "@/app/lib/pause-signal";
import type { ApprovalMode } from "@/worker/src/lib/approval";
import { classify, type ToolClass } from "@/worker/src/lib/classify";
import type { ModelId } from "@/lib/pricing";

// Vercel AI SDK `useChat`. Streams from /api/chat -> worker SSE.
// 01-04 / 01-11 — inline ApprovalCard for write_low + write_high tool calls
// and a header AutoApproveToggle that threads approvalMode into the body.
// 01-08 — header CostCounter aggregates message.usage across the session.
// 01-10 / UI-03 / UI-05 — ActionFeed renders inline bubbles for every tool part;
// TransientAgentError retried 3 times (1s/2s/4s); permanent errors surface toast.

interface ToolApprovalPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  tier?: ApprovalTier;
}

// AI SDK v5 — approval-request chunk has { approvalId, toolCallId }.
// Args + toolName live on the linked tool part (`tool-<name>` with same toolCallId).
type ApprovalRequestPart = { type: "tool-approval-request"; approvalId: string; toolCallId: string };
type ToolPart = { type: string; toolCallId?: string; toolName?: string; input?: Record<string, unknown> };

function lookupToolPart(parts: unknown[], toolCallId: string): ToolPart | undefined {
  return (parts as ToolPart[]).find(
    (p) => typeof p?.type === "string" && p.type.startsWith("tool-") && p.toolCallId === toolCallId,
  );
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
  const [input, setInput] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  // Ref mirror of `messages` so usePauseOnUnload sees the latest array at unload time.
  const messagesRef = useRef<UIMessage[]>([]);

  // AI SDK v5 useChat: messages + sendMessage + status + setMessages. body is
  // passed via DefaultChatTransport (a top-level `body` option was removed in v5).
  // 01-U — body must be a function so the captured transport re-reads the React
  // closure on every sendMessage (post-mount setSessionId(fresh) propagates).
  // 01-V — drop `messages: initialMessages` from the seed prop (the prop is only
  // honored at first construction; setting it after mount is silently dropped).
  // Instead, destructure `setMessages` (UseChatHelpers at @ai-sdk/react/dist/index.d.ts:25)
  // and call it inside the mount-fetch's `.then` handler to push the fetched
  // snapshot into the hook's internal state. useChat re-renders with the
  // populated array — no `loaded` gate, no `key={...}` remount, no parent-fetch.
  // ponytail: cast — DefaultChatTransport from `ai` and ChatTransport from
  // `@ai-sdk/react` are structurally identical but nominally distinct.
  const { messages, sendMessage, status, setMessages } = useChat<UIMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ approvalMode, sessionId }),
    }) as never,
  });
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const isLoading = status === "submitted" || status === "streaming";

  const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  const [err, setErr] = useState<string | null>(null);

  // 01-13 / D-07 — pause the worker on tab close; SSE reconnect re-emits the same tool-call-approval chunk.
  // 01-Q — ship the latest messages array so the worker can replay them on resume.
  usePauseOnUnload(sessionId, messagesRef.current);

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
  // 01-V — setMessages is the only way to seed useChat with messages AFTER mount.
  // The `messages` prop is the initial seed captured at hook construction;
  // subsequent prop changes do not update the array. Fetched snapshot is pushed
  // via setMessages(body.messages) below (UseChatHelpers at
  // @ai-sdk/react/dist/index.d.ts:25).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = loadSessionId();
    if (existing) {
      setSessionId(existing);
      // Fetch prior messages for this session; push them into useChat's
      // internal messages array via setMessages (the documented API for
      // mutating messages after hook construction).
      fetch(`/api/messages?sessionId=${encodeURIComponent(existing)}`)
        .then((r) => r.json() as Promise<{ messages?: unknown[] }>)
        .then((body) => {
          if (Array.isArray(body.messages)) {
            setMessages(body.messages as UIMessage[]);
          }
        })
        .catch(() => { /* no prior messages — keep empty */ });
      return;
    }
    const fresh = `sess-${Math.random().toString(36).slice(2, 10)}`; saveSessionId(fresh); setSessionId(fresh);
  }, [setMessages]);

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
    await sendMessage({
      text:
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
          <CostCounter messages={messages as unknown as Parameters<typeof CostCounter>[0]["messages"]} model={((messages.at(-1) as unknown as { metadata?: { modelId?: string } } | undefined)?.metadata?.modelId ?? "opencode-go/hy3") as ModelId} />
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
                {parts.map((p, i) => {
                  const tp = p as unknown as { type: string; text?: string };
                  return tp.type === "text" ? <span key={`txt-${i}`}>{tp.text}</span> : null;
                })}
                <ActionFeed parts={parts} />
                {parts.map((p, i) => {
                  if (p.type !== "tool-approval-request") return null;
                  const ap = p as unknown as ApprovalRequestPart;
                  const toolPart = lookupToolPart(parts, ap.toolCallId);
                  const toolName = (toolPart?.toolName) ?? (toolPart?.type?.startsWith("tool-") ? toolPart.type.slice("tool-".length) : "unknown");
                  const toolClass: ToolClass = toolName ? classify(toolName) : "write_low";
                  const approvalTier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
                  const approvalPart: ToolApprovalPart = {
                    type: "tool-approval-request",
                    toolCallId: ap.toolCallId,
                    toolName,
                    args: toolPart?.input ?? {},
                    tier: approvalTier,
                  };
                  return (
                    <ApprovalCard
                      key={`card-${i}`}
                      tier={approvalPart.tier ?? "write_low"}
                      toolName={approvalPart.toolName ?? "unknown"}
                      args={approvalPart.args ?? {}}
                      onApprove={() => decide("approve", approvalPart)}
                      onDecline={() => decide("decline", approvalPart)}
                      onApproveAll={(pat) => decide("approve", approvalPart, pat)}
                    />
                  );
                })}
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
      <form onSubmit={onFormSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
