---
status: diagnosed
trigger: "Gap G-1-16: Cost counter static at $0.0000 across replies — 01-P shipped the wire but value never updates."
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: The wire (a)+(b) shipped correctly per 01-P. The remaining cause is (c) — opencode-go/hy3 PRICING row has rates of $0/$0 (placeholder), so even if tokens flow, cost is mathematically $0.
test: n/a — diagnosis only (goal: find_root_cause_only)
expecting: n/a
next_action: return ROOT CAUSE FOUND with suspect (c) as primary, (a) as unverified secondary

## Symptoms

expected: Cost counter shows non-zero USD value that updates after each reply
actual: Cost counter displays '~ $0.0000' and value does not change across multiple replies
errors: none observed (no TypeError, no NaN, no crash — silent $0)
reproduction: Send any chat reply → check CostCounter in header stays $0.0000
started: Discovered 2026-08-20 during UAT retest after gap-closure plan 01-P

## Eliminated

- hypothesis: "(b) CostCounter not finding data-usage parts — wrong part-type string"
  evidence: |
    Worker emits `{ type: "data-usage", data: {...} }` (worker/src/index.ts:189).
    CostCounter filters on `p.type === "data-usage"` (CostCounter.tsx:36).
    Strings match exactly. The data structure is correct per AI SDK v5 contract:
    `DataUIMessageChunk` lands on `m.parts[i].data`, NOT `m.usage` (m.usage does not
    exist on UIMessage — only id, role, metadata, parts).
  timestamp: 2026-08-20

- hypothesis: "ChatPanel not passing model prop to CostCounter"
  evidence: |
    ChatPanel.tsx:193 passes `model={((messages.at(-1) as unknown as { metadata?: { modelId?: string } } | undefined)?.metadata?.modelId ?? "opencode-go/hy3") as ModelId}`.
    Worker start chunk emits `messageMetadata: { modelId: "opencode-go/hy3" }` (worker/src/index.ts:135).
    Default fallback `"opencode-go/hy3"` is a valid ModelId union member.
  timestamp: 2026-08-20

- hypothesis: "ModelId union still excludes opencode-go/hy3 (would throw on lookup)"
  evidence: |
    lib/pricing.ts:3 — `ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash" | "opencode-go/hy3"`.
    PRICING row added at lib/pricing.ts:24. estimateCostUsd guard at lines 36-42 returns 0 + warns
    on missing key. TypeError no longer possible.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: worker/src/index.ts:178-192 (step-finish branch)
  found: |
    ```ts
    } else if (chunk.type === "step-finish") {
      const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
      const usage = payload?.totalUsage;
      if (usage) {
        const inTok = usage.inputTokens ?? 0;
        const outTok = usage.outputTokens ?? 0;
        void patchTokens(sessionId ?? "anon", lastToolName, inTok, outTok).catch(() => {});
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "data-usage", data: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok } })}\n\n`),
        );
      }
    }
    ```
  implication: |
    Wire-side emission is correctly coded. However, the chunk is GATED by `if (usage)`.
    If opencode-go/hy3 (the upstream provider) does not populate `payload.totalUsage`,
    the chunk is silently skipped — no log, no fallback. Suspect (a) remains PLAUSIBLE
    but cannot be confirmed without runtime worker logs.

- timestamp: 2026-08-20
  checked: app/components/CostCounter.tsx:36-44 (read path)
  found: |
    ```ts
    for (const p of m.parts ?? []) {
      if (p.type === "data-usage") {
        const d = (p as { data?: { inputTokens?: number; outputTokens?: number } }).data;
        if (d) {
          tokensIn += d.inputTokens ?? 0;
          tokensOut += d.outputTokens ?? 0;
        }
      }
    }
    const usd = estimateCostUsd(model, tokensIn, tokensOut);
    ```
  implication: |
    Counter correctly sums `m.parts[i].data` for type === "data-usage". Calls
    `estimateCostUsd(model, tokensIn, tokensOut)` where model comes from ChatPanel
    (defaults to "opencode-go/hy3" if metadata missing).

- timestamp: 2026-08-20
  checked: lib/pricing.ts:11-25 (PRICING table)
  found: |
    ```ts
    "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
    ```
    Inline comment notes: "Per-token rates are unverified for Phase 1; default to $0/$0 until
    operator confirms the tier (https://opencode.dev/pricing). The PRICING row is present so
    ModelId union compiles and estimateCostUsd never throws on missing key."
  implication: |
    CONFIRMED ROOT CAUSE for symptom "static $0.0000": rates are $0/$0. Even with
    non-zero tokensIn/tokensOut, `estimateCostUsd` computes
    `(tokensIn * 0 + tokensOut * 0) / 1_000_000 = 0` regardless. The display is
    mathematically correct — the model genuinely is free at the pricing layer
    (placeholder pending operator verification per the comment).

- timestamp: 2026-08-20
  checked: lib/pricing.ts:30-44 (estimateCostUsd math)
  found: `return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;`
  implication: |
    With opencode-go/hy3 inputPerMTok=0 and outputPerMTok=0, the product is always 0.
    No amount of token accumulation can produce a non-zero USD value for this model.

- timestamp: 2026-08-20
  checked: app/components/ChatPanel.tsx:193 (model prop)
  found: |
    `<CostCounter ... model={((messages.at(-1) as ...).metadata?.modelId ?? "opencode-go/hy3") as ModelId} />`
  implication: |
    Model is correctly threaded from worker start chunk's messageMetadata → useChat metadata →
    ChatPanel reads `messages.at(-1).metadata.modelId` → CostCounter. Default fallback
    "opencode-go/hy3" is itself a PRICING row, so no missing-key throw. The chain is correct.

## Resolution

root_cause: |

  **(c) opencode-go/hy3 PRICING row has rates of $0/$0** — `lib/pricing.ts:24`.

  The 01-P closure plan shipped the wire (data-usage chunks, messageMetadata,
  ModelId union, guard against missing keys) but did NOT update the placeholder
  rates. The inline comment at `lib/pricing.ts:20-23` explicitly states:

    "Per-token rates are unverified for Phase 1; default to $0/$0 until operator
     confirms the tier (https://opencode.dev/pricing)."

  With `inputPerMTok: 0` and `outputPerMTok: 0`, `estimateCostUsd` returns 0 for
  any token volume:

    `(tokensIn * 0 + tokensOut * 0) / 1_000_000 = 0`

  The displayed "$0.0000" is therefore mathematically correct given the current
  PRICING row. Whether the worker step-finish branch actually emits data-usage
  chunks (suspect (a)) is UNVERIFIED — the emission is gated by `if (usage)`
  with no log to confirm whether `payload.totalUsage` is populated by opencode-go/hy3.
  But this is secondary: even with full token flow, the counter would still show
  $0.0000 due to (c).

fix: |
  (Direction only — not applied. Diagnosis mode.)

  Update `lib/pricing.ts:24` with verified rates for opencode-go/hy3:

  - If the model is genuinely free (e.g., OpenRouter free tier or opencode-go's
    free quota), keep $0/$0 and ACCEPT G-1-16 as not-a-bug — the display is correct,
    the user just needs to know this model is free. Mark the gap resolved with
    severity = "accepted-as-design".

  - If the model has non-zero rates (likely — opencode-go/hy3 is a real paid tier
    per opencode.dev/pricing), update to the actual per-1M rates. The deepseek-v4-flash
    row at lib/pricing.ts:15-19 is a working reference: `{ inputPerMTok: 0.077,
    outputPerMTok: 0.153 }`.

  Optional secondary check (suspect (a) — unverified): add a debug log inside the
  step-finish branch to surface whether `payload.totalUsage` is populated by the
  upstream opencode-go provider:

    ```ts
    } else if (chunk.type === "step-finish") {
      const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
      const usage = payload?.totalUsage;
      console.log(`[chat-debug] step-finish usage=${JSON.stringify(usage)}`);
      if (usage) { ... existing emit ... }
    }
    ```

  If `usage` is undefined/null, the provider doesn't report it and the data-usage
  chunk is silently skipped. In that case, no pricing fix will make the counter
  move — the fix is upstream (provider must report token usage).

verification: |
  (Direction only.)

  - Static: confirm `lib/pricing.ts:24` matches the actual tier (visit
    https://opencode.dev/pricing or OpenRouter's model page).
  - Runtime (if rates updated): smoke chat "hello" → CostCounter shows non-zero USD
    that increments with reply length.
  - Runtime (if upstream doesn't report usage): confirm via worker terminal log
    whether step-finish.totalUsage is populated. If undefined, this gap cannot be
    closed until the provider reports usage.

files_changed:
  - lib/pricing.ts (update opencode-go/hy3 PRICING rates from $0/$0 placeholder to verified values, OR document as accepted-as-free)

## Prevention

01-P summary claimed to "Add opencode-go/hy3 row to PRICING" without updating the
rates from $0/$0 placeholder. The must-have should have been "update to verified
rates OR document as accepted-as-free" — the closure plan shipped the structural
fix without verifying the value. Future gap closures that touch pricing should
verify the actual rates (operator-confirmed, not placeholder), not just the row
existence.
