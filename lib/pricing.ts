// Pricing table — single source of truth for UI-06 cost HUD.
// Values are USD per 1M tokens. Update when the model mix changes.
export type ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash";

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
};

export function estimateCostUsd(
  model: ModelId,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = PRICING[model];
  return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;
}
