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

// ToolApprovalPart — the shape ChatPanel builds locally before handing to
// <ApprovalCard />. NOT a wire part type; the wire carries `tool-<name>` parts
// with `state: 'approval-requested'` + `approval: { id, ... }` (see
// ai/src/ui/process-ui-message-stream.ts:746-758 — the approval-request chunk
// MUTATES the existing tool part rather than pushing a new top-level part).
interface ToolApprovalPart {
  type: string;
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
  const [input, setInput] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Upload dropped/selected .md files → /api/ingest → tool_docs (chunked + embedded).
  // Separate from the chat stream: it seeds RAG, it does not call the agent.
  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    let ok = 0;
    const summaries: string[] = [];
    for (const f of arr) {
      if (!/\.(md|markdown|txt|text)$/i.test(f.name)) {
        setToast(`Skipped ${f.name}: only .md/.markdown/.txt`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await fetch("/api/ingest", { method: "POST", body: fd });
        const j = (await r.json()) as {
          ok?: boolean;
          error?: string;
          tool?: string;
          inserted?: number;
          embedded?: number;
        };
        if (r.ok && j.ok) {
          ok++;
          summaries.push(`${j.tool} (+${j.inserted}, ${j.embedded} embedded)`);
        } else {
          setToast(`Ingest failed (${f.name}): ${j.error ?? r.status}`);
        }
      } catch (e) {
        setToast(`Ingest failed (${f.name}): ${(e as Error).message}`);
      }
    }
    if (ok > 0) {
      setToast(`Ingested ${ok} doc(s) into tool_docs: ${summaries.join(", ")}`);
    }
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
      // 01-Y — worker resumes the suspended run server-side and pipes the
      // MastraModelOutput.fullStream back as SSE. The streamed body carries
      // tool-result + assistant follow-up text; we don't read it in this
      // React tree (useChat owns the chat transport, and a second concurrent
      // stream would fight the parser). Instead, reload the page — the
      // post-mount useEffect's fetch /api/messages populates useChat with
      // the resumed state, and the user sees the result.
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
    // ponytail: window.location.reload() instead of a second sendMessage —
    // Phase 8 swaps this for a streaming-aware chat pattern that consumes
    // the resumed stream inline. The page-refresh loses any in-flight typing
    // (acceptable for a single-user Phase 1 demo).
    if (typeof window !== "undefined") {
      window.location.reload();
    }
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
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        style={{
          minHeight: 240,
          padding: 12,
          border: `1px ${dragActive ? "dashed" : "solid"} ${dragActive ? "#3a86ff" : "#2a2f3a"}`,
          borderRadius: 8,
          background: "#161922",
          overflowY: "auto",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#8b94a7", margin: 0 }}>
            Type &quot;hello&quot; (read), &quot;create a note&quot; (write_low), or &quot;apply migrations&quot; (write_high). Drag a .md file here or hit Upload to add docs to RAG.
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
                  // AI SDK v7: the tool-approval-request chunk MUTATES the existing tool part
                  // (looked up by toolCallId) to { state: 'approval-requested', approval: { id } }.
                  // Filter on the tool part's state, not on a non-existent top-level part type.
                  // ActionFeed.tsx:46-65 uses the same dimension — confirmed correct.
                  const tp = p as unknown as {
                    type: string;
                    toolCallId?: string;
                    toolName?: string;
                    input?: Record<string, unknown>;
                    state?: string;
                    approval?: { id?: string; isAutomatic?: boolean };
                  };
                  if (!tp.type.startsWith("tool-") || tp.state !== "approval-requested") return null;
                  // ponytail: skip auto-approved tool calls — they have no card to show.
                  if (tp.approval?.isAutomatic) return null;
                  // Read toolName/input/approval.id directly from the tool part (no separate lookup).
                  const toolName = tp.toolName ?? tp.type.slice("tool-".length);
                  const toolClass: ToolClass = toolName ? classify(toolName) : "write_low";
                  const approvalTier: ToolApprovalPart["tier"] = toolClass === "write_high" ? "write_high" : "write_low";
                  const approvalPart: ToolApprovalPart = {
                    type: tp.type,
                    toolCallId: tp.toolCallId,
                    toolName,
                    args: tp.input ?? {},
                    tier: approvalTier,
                  };
                  return (
                    <ApprovalCard
                      key={`card-${tp.toolCallId ?? i}`}
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.text"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #3a4256",
            background: "#222a3a",
            color: "#e6e6e6",
            cursor: "pointer",
          }}
        >
          Upload
        </button>
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
