"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";

// Vercel AI SDK `useChat`. Streams from /api/chat → worker SSE.
// Phase 1: simple text bubbles; Phase 2 adds the ActionFeed overlay.
export function ChatPanel() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Surface stream errors as a toast (UI-05 stub — full auto-retry ships in 01-D).
    const onError = (e: ErrorEvent) => setErr(e.message);
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          <p style={{ color: "#8b94a7", margin: 0 }}>Type &quot;hello&quot; to test the echo round-trip.</p>
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
            <div style={{ marginTop: 4 }}>{m.content}</div>
          </div>
        ))}
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>{err}</div>}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="hello"
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
