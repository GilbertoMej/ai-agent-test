// Pricing table — single source of truth for UI-06 cost HUD.
// Values are USD per 1M tokens. Update when the model mix changes.
export type ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash" | "opencode-go/hy3";

export interface PriceRow {
  inputPerMTok: number;
  outputPerMTok: number;
  display: string;
}

export const PRICING: Record<ModelId, PriceRow> = {
  // D-02: OpenRouter free tier — NVIDIA logs traffic, but cost is $0.
  "nemotron-3-ultra-free": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free)" },
  // D-03: DeepSeek V4 Flash via InsForge gateway — verified at openrouter.ai/deepseek.
  "deepseek-v4-flash": {
    inputPerMTok: 0.077,
    outputPerMTok: 0.153,
    display: "$0.077 / $0.153 per 1M",
  },
  // ponytail: opencode-go/hy3 is the Anthropic-hosted research-preview tier for
  // Phase 1 — free, no published per-token rate (verified at
  // platform.claude.com/docs/en/about-claude/pricing on 2026-08-21; the
  // Anthropic pricing page lists no entry for this model). Cost counter shows
  // $0.00 intentionally. Update with real rates when a paid-tier model is added
  // (Phase 2+); 01-Z-SUMMARY.md records this as an accept-as-design decision.
  "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
};

// Tracks which unknown model ids we've warned about — avoids log spam if the
// caller passes a model the pricing table hasn't been updated for yet.
const warnedModels = new Set<string>();
export function estimateCostUsd(
  model: ModelId,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = PRICING[model];
  if (!p) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(`pricing: no entry for model "${model}" — returning 0. Update lib/pricing.ts PRICING table.`);
    }
    return 0;
  }
  return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;
}
