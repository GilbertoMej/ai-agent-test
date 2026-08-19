"use client";

import { estimateCostUsd, type ModelId } from "@/lib/pricing";

// 01-08 — header cost HUD. Aggregates usage tokens across the session's messages
// and multiplies by lib/pricing.ts. Phase 1 displays ~$0.000 (Nemotron is free).
//
// ponytail: subscribes to message.usage from useChat; no separate stream listener.
// When AI SDK v7 reports step-finish, the messages array re-renders with usage
// populated on the finished message — this counter recomputes on each update.

export interface ChatMessageLike {
  id: string;
  role: string;
  // AI SDK v7 populates `usage` per-message after the stream finishes.
  // Both shapes are tolerated for forward-compat.
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export function CostCounter({
  messages,
  model = "nemotron-3-ultra-free",
}: {
  messages: readonly ChatMessageLike[];
  model?: ModelId;
}) {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const m of messages) {
    if (!m.usage) continue;
    tokensIn += m.usage.inputTokens ?? 0;
    tokensOut += m.usage.outputTokens ?? 0;
  }
  const usd = estimateCostUsd(model, tokensIn, tokensOut);
  return (
    <span
      title={`tokens in ${tokensIn} · out ${tokensOut}`}
      style={{
        fontSize: 12,
        fontFamily: "monospace",
        color: "#8b94a7",
      }}
    >
      ~ ${usd.toFixed(4)}
    </span>
  );
}
