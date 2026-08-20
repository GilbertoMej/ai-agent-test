"use client";

import { estimateCostUsd, type ModelId } from "@/lib/pricing";

// 01-08 — header cost HUD. Aggregates usage tokens across the session's messages
// and multiplies by lib/pricing.ts. Phase 1 displays ~$0.000 (Nemotron is free).
//
// 01-P — wire contract bridge: AI SDK v5 UIMessage has no `m.usage` field. Usage
// arrives as a `data-usage` DataUIMessageChunk landing on `m.parts[i].data`. The
// Counter sums across all data-usage parts. The active model id is sourced from
// `m.metadata?.modelId` (populated by the worker start chunk's messageMetadata).

export interface ChatMessageLike {
  id: string;
  role: string;
  metadata?: { modelId?: string };
  // AI SDK v5 UIMessage has no `usage` field. Usage arrives as a DataUIMessageChunk
  // of type "data-usage" on `m.parts[i].data`. See lib/pricing.ts + worker step-finish.
  parts?: Array<
    | { type: string; data?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }
    | Record<string, unknown>
  >;
}

export function CostCounter({
  messages,
  model = "opencode-go/hy3",
}: {
  messages: readonly ChatMessageLike[];
  model?: ModelId;
}) {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === "data-usage") {
        // Record<string, unknown> in the union prevents TS from narrowing `p.data`;
        // narrow explicitly at the use site.
        const d = (p as { data?: { inputTokens?: number; outputTokens?: number } }).data;
        if (d) {
          tokensIn += d.inputTokens ?? 0;
          tokensOut += d.outputTokens ?? 0;
        }
      }
    }
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
