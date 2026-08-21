---
phase: 1
plan: P
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-10]
depends_on: []
files_modified:
  - lib/pricing.ts
  - app/components/CostCounter.tsx
  - app/components/ChatPanel.tsx
  - worker/src/index.ts
autonomous: true
must_haves:
  - "`lib/pricing.ts:3` ModelId union includes `opencode-go/hy3`; PRICING has a row for it; `estimateCostUsd` guards against missing keys (returns 0 + warns once)"
  - "Worker `step-finish` branch emits a `data-usage` `DataUIMessageChunk` carrying `{inputTokens, outputTokens, totalTokens}` to the SSE stream"
  - "Worker `start` chunk emits `messageMetadata: { modelId: 'opencode-go/hy3' }` so `useChat` populates `messages[i].metadata.modelId`"
  - "`CostCounter` reads `m.parts[i].type === 'data-usage'` instead of `m.usage`; sums across all data-usage parts"
  - "`ChatPanel` passes `model={messages.at(-1)?.metadata?.modelId}` (or lastMessage.metadata.modelId) to CostCounter"
  - "`pnpm tsc --noEmit` introduces no new errors"
  - "Live: after a chat reply, the header CostCounter shows a non-zero USD value (e.g. ~$0.0001 or whatever opencode-go/hy3's per-1M rate produces)"
requirements:
  - UI-06
---

# 01-P — Phase 1 Gap Closure (CostCounter ticks from usage)

Closes G-1-10 (minor): THREE stacked defects.

(1) `lib/pricing.ts:3` — `ModelId` union excludes `opencode-go/hy3` (the post-G-1-6 active model). `estimateCostUsd` throws `TypeError` on a missing key, not NaN.
(2) `app/components/CostCounter.tsx:22` — defaults `model = "nemotron-3-ultra-free"` with `$0/$0` pricing; `ChatPanel.tsx:170` doesn't override. Cost is mathematically pinned to `$0.0000`.
(3) `worker/src/index.ts:164-175` — `step-finish` branch consumes `totalUsage` for server-side audit only and emits zero usage chunks to SSE. AI SDK v5 `UIMessage` has no `usage` field; usage lives on `m.parts[i].data` via a `data-usage` `DataUIMessageChunk`. 01-D-SUMMARY:185 + 01-VERIFICATION:108 both factually wrong about `m.usage`.

Fix is FOUR coordinated edits in FOUR files: extend pricing table, emit usage chunk + modelId metadata from worker, update CostCounter to read data-usage parts, pass modelId from ChatPanel.

## Tasks

<task type="auto">
  <id>01-P1-extend-pricing-table-with-hy3</id>
  <read_first>
    - lib/pricing.ts (full file — line 3 ModelId union; lines 11-20 PRICING table; lines 22-29 estimateCostUsd)
    - .planning/debug/g-1-10-cost-counter-zero.md (Cause 1 root-cause trace)
  </read_first>
  <action>
    Single edit to `lib/pricing.ts`.

    **Edit A — ModelId union** (line 3): add `opencode-go/hy3`.

    Current:
    ```
    export type ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash";
    ```

    Replacement:
    ```
    export type ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash" | "opencode-go/hy3";
    ```

    **Edit B — PRICING row** (after line 19, before the closing `};` on line 20): add the opencode-go/hy3 entry. OpenCode Go is a paid provider (https://opencode.dev/pricing); for Phase 1 we record the tier as `$0/$0` with `display: "$0 (free tier — confirm at opencode.dev/pricing)"` so the wire contract works and the counter ticks $0 — operators confirm the real rate before relying on the counter for billing. The PRICING entry exists primarily so `estimateCostUsd("opencode-go/hy3", ...)` is defined at runtime and so the `data-usage` wire path can be exercised end-to-end.

    ```
      // D-02 successor (post-G-1-6) — OpenCode Go hy3 model. Per-token rates are
      // unverified for Phase 1; default to $0/$0 until operator confirms the tier
      // (https://opencode.dev/pricing). The PRICING row is present so ModelId union
      // compiles and estimateCostUsd never throws on missing key.
      "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
    ```

    **Edit C — Guard `estimateCostUsd` against missing keys** (replace lines 22-29). Single guard in the shared function beats guarding every caller.

    Current:
    ```
    export function estimateCostUsd(
      model: ModelId,
      tokensIn: number,
      tokensOut: number,
    ): number {
      const p = PRICING[model];
      return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;
    }
    ```

    Replacement:
    ```
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
    ```

    Three changes:
    1. Add `opencode-go/hy3` to the ModelId union so the type system accepts the new id.
    2. Add the PRICING row so runtime access doesn't fall into the warning branch.
    3. Add a guard for any future model-id drift — single shared guard, one warn per unknown id.

    Do NOT change the other two PRICING rows (nemotron and deepseek-v4-flash) — Phase 1 keeps their values.
  </action>
  <files>lib/pricing.ts</files>
  <verify>
    <automated>grep -nE '"opencode-go/hy3"' lib/pricing.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && grep -nE 'pricing: no entry for model' lib/pricing.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'export type ModelId' lib/pricing.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep '"opencode-go/hy3"' lib/pricing.ts` returns 2+ matches (union + PRICING row)
    - `grep 'pricing: no entry for model' lib/pricing.ts` returns 1 match (guard added)
    - `grep 'export type ModelId' lib/pricing.ts` returns 1 match (union preserved)
    - `pnpm tsc --noEmit` introduces no new errors in pricing.ts (pricing.ts has no pre-existing TS errors)
  </acceptance_criteria>
  <done>ModelId union includes the active model; PRICING has a row; estimateCostUsd never throws on missing key — degrades to 0 + one-time warn.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-06 (header shows running token-cost estimate)</implements>
  <commit>fix(pricing): add opencode-go/hy3 row + guard estimateCostUsd against missing keys</commit>
</task>

<task type="auto">
  <id>01-P2-emit-data-usage-chunk-and-modelid-metadata</id>
  <read_first>
    - worker/src/index.ts (lines 117-178 — stream route SSE body; lines 121-123 start chunk; lines 164-175 step-finish branch)
    - node_modules/ai/dist/index.d.ts (lines 2271-2278 — DataUIMessageChunk shape; lines 2279-2344 — UIMessageChunk union)
    - .planning/debug/g-1-10-cost-counter-zero.md (Cause 3 — design-out, not a forgotten handler)
  </read_first>
  <action>
    Two edits to `worker/src/index.ts` — both inside the SSE `start(controller)` closure (lines 115-191).

    **Edit A — Emit `modelId` via the start chunk's messageMetadata** (replace lines 121-123).

    Current:
    ```
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: msgId })}\n\n`),
    );
    ```

    Replacement:
    ```
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: "start", messageId: msgId, messageMetadata: { modelId: "opencode-go/hy3" } })}\n\n`),
    );
    ```

    AI SDK v5's UIMessageChunk `start` accepts an optional `messageMetadata` field that `useChat` parses and surfaces on `messages[i].metadata` (per `node_modules/ai/dist/index.d.ts`). Single source of truth for the active modelId — CostCounter reads from there (no hardcoded default in the Counter).

    **Edit B — Emit a `data-usage` chunk from the step-finish branch** (replace lines 164-175).

    Current:
    ```
    } else if (chunk.type === "step-finish") {
      const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
      const usage = payload?.totalUsage;
      if (usage) {
        void patchTokens(
          sessionId ?? "anon",
          lastToolName,
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
        ).catch(() => {});
      }
    }
    ```

    Replacement:
    ```
    } else if (chunk.type === "step-finish") {
      const payload = chunk.payload as { totalUsage?: { inputTokens?: number; outputTokens?: number } } | undefined;
      const usage = payload?.totalUsage;
      if (usage) {
        const inTok = usage.inputTokens ?? 0;
        const outTok = usage.outputTokens ?? 0;
        // Server-side audit (BCK-03) — patch the most recent row.
        void patchTokens(sessionId ?? "anon", lastToolName, inTok, outTok).catch(() => {});
        // Client-side wire (UI-06) — data-usage DataUIMessageChunk lands on m.parts[i].data,
        // NOT m.usage (which doesn't exist on UIMessage). The Counter reads from parts.
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "data-usage", data: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok } })}\n\n`),
        );
      }
    }
    ```

    Two changes:
    1. Hoist `usage.inputTokens ?? 0` / `usage.outputTokens ?? 0` into named locals so the audit patch and the wire chunk share the same values.
    2. Emit a `data-usage` DataUIMessageChunk carrying `{ inputTokens, outputTokens, totalTokens }`. The `totalTokens` field is the sum for client convenience. The chunk lands on `m.parts[i].data` per the AI SDK v5 wire contract; Counter reads from there.

    The `patchTokens` call stays — it is the server-side audit path (BCK-03).

    Do NOT change any other branch of the for-await loop. Do NOT change the encoder (TextEncoder is the right tool). Do NOT change the `data: [DONE]` terminator on line 178.
  </action>
  <files>worker/src/index.ts</files>
  <verify>
    <automated>grep -nE 'messageMetadata.*modelId.*opencode-go' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'type: "data-usage"' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'inputTokens: inTok.*outputTokens: outTok' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'messageMetadata.*modelId.*opencode-go' worker/src/index.ts` returns 1+ match (modelId metadata on start chunk)
    - `grep '"data-usage"' worker/src/index.ts` returns 1+ match (data-usage chunk emitted from step-finish)
    - `grep 'inputTokens: inTok, outputTokens: outTok' worker/src/index.ts` returns 1+ match (named locals used)
    - `grep 'patchTokens(' worker/src/index.ts` returns 1+ match (audit path preserved)
    - `pnpm tsc --noEmit` introduces no new errors in index.ts
  </acceptance_criteria>
  <done>Worker emits modelId on the start chunk + a data-usage chunk on each step-finish; client Counter can now read both.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-06 (token-cost estimate increments after each agent step)</implements>
  <commit>fix(worker): emit data-usage chunk + messageMetadata.modelId — bridge wire contract</commit>
</task>

<task type="auto">
  <id>01-P3-cost-counter-reads-data-usage-parts</id>
  <read_first>
    - app/components/CostCounter.tsx (full file — line 22 default model; line 30-33 usage loop)
    - app/components/ChatPanel.tsx (line 170 — `<CostCounter messages=... />` no model prop)
    - node_modules/ai/dist/index.d.ts (lines 1818-1843 — UIMessage interface; lines 2271-2278 — DataUIMessageChunk shape)
  </read_first>
  <action>
    Two coordinated edits across two files.

    **Edit A — `app/components/CostCounter.tsx`**: change the type + the read + the default.

    Current full file (lines 1-47). Three changes:

    1. Update `ChatMessageLike` interface (lines 12-18) to reflect the real wire shape: no `usage` field; `parts` array; `metadata?.modelId` on the message; `data-usage` part shape.

    Replacement for lines 12-18:
    ```
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
    ```

    2. Replace the default model (line 22). After P1, the active model id arrives via `messages[i].metadata.modelId`. Drop the hardcoded `"nemotron-3-ultra-free"`; default to `"opencode-go/hy3"` (the current agent model per `worker/src/agents/sdlc.ts:23`).

    Replacement for line 22:
    ```
      model = "opencode-go/hy3",
    ```

    3. Replace the usage loop (lines 27-33). Sum across all data-usage parts.

    Replacement for lines 27-33:
    ```
      let tokensIn = 0;
      let tokensOut = 0;
      for (const m of messages) {
        for (const p of m.parts ?? []) {
          if (p.type === "data-usage" && p.data) {
            tokensIn += p.data.inputTokens ?? 0;
            tokensOut += p.data.outputTokens ?? 0;
          }
        }
      }
    ```

    The `const usd = estimateCostUsd(model, tokensIn, tokensOut);` call (line 34) is unchanged — `model` is now the resolved string from props.

    **Edit B — `app/components/ChatPanel.tsx`**: pass `model` prop to CostCounter, sourced from the last message's metadata. Replace line 170.

    Current line 170:
    ```
    <CostCounter messages={messages as unknown as Parameters<typeof CostCounter>[0]["messages"]} />
    ```

    Replacement:
    ```
    const lastModel = ((messages.at(-1) as unknown as { metadata?: { modelId?: string } } | undefined)?.metadata?.modelId) ?? "opencode-go/hy3";
    <CostCounter messages={messages as unknown as Parameters<typeof CostCounter>[0]["messages"]} model={lastModel as ModelId} />
    ```

    Add the import at the top of ChatPanel.tsx (next to existing pricing/imports if any): `import type { ModelId } from "@/lib/pricing";`. (Already importing `DefaultChatTransport`, `UIMessage`, etc.)

    Three changes:
    1. Compute `lastModel` from the last message's metadata.modelId, defaulting to `opencode-go/hy3`.
    2. Pass it to CostCounter as the `model` prop.
    3. Type the prop as `ModelId` so any drift in the metadata surface (string vs ModelId union) is caught at compile time.

    Do NOT change the cost-rendering `<span>` block (lines 35-46 of CostCounter) — the `~ ${usd.toFixed(4)}` text and the `title={`tokens in ${tokensIn} · out ${tokensOut}`}` tooltip are unchanged.
  </action>
  <files>app/components/CostCounter.tsx, app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -nE 'type === "data-usage"' app/components/CostCounter.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'model = "opencode-go/hy3"' app/components/CostCounter.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'metadata\?:\s*\{.*modelId\?:\s*string' app/components/CostCounter.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'lastModel.*metadata.*modelId' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'model=\{lastModel' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'import type \{ ModelId \}' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'type === "data-usage"' app/components/CostCounter.tsx` returns 1 match (usage read from parts)
    - `grep 'model = "opencode-go/hy3"' app/components/CostCounter.tsx` returns 1 match (default model updated)
    - `grep 'metadata?: { modelId?: string }' app/components/CostCounter.tsx` returns 1 match (interface widened)
    - `grep 'lastModel' app/components/ChatPanel.tsx` returns 1+ match (model derived from metadata)
    - `grep 'model={lastModel' app/components/ChatPanel.tsx` returns 1 match (prop wired)
    - `grep 'import type { ModelId }' app/components/ChatPanel.tsx` returns 1 match (type imported)
    - `pnpm tsc --noEmit` introduces no new errors in CostCounter.tsx or ChatPanel.tsx
  </acceptance_criteria>
  <done>CostCounter reads data-usage parts (the real wire field), not the non-existent `m.usage`; receives `model` from the last message's metadata; renders a non-zero USD value after the first chat reply.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-06 (token-cost estimate in header)</implements>
  <commit>fix(costcounter): read data-usage parts + modelId from message metadata</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Worker SSE → browser | Encoded via `TextEncoder`; no auth on the SSE stream (the route is in-process from Next). `messageMetadata.modelId` is operator-authored; not user-controlled. |
| Pricing data → client | `lib/pricing.ts` is bundled into the client (CostCounter imports it). Operator-authored; no secrets in PRICING. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-P-01 | Information Disclosure | PRICING in client bundle | low | accept | PRICING is operator-authored rates; no secrets. |
| T-1-P-02 | Tampering | messageMetadata.modelId | low | accept | Sent from worker, not user input. Single source of truth. |
| T-1-P-03 | Tampering | Token counts | low | mitigate | `totalUsage` is provider-reported; the worker doesn't synthesize. `patchTokens` runs server-side audit independently. |

## Verification

1. Static: grep confirms pricing extension, model metadata on start chunk, data-usage chunk on step-finish, CostCounter reads parts, ChatPanel passes model prop.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; trigger `use echo to say hello`; observe CostCounter header increments from `$0.0000` to a non-zero value (depends on opencode-go/hy3 tier — `~$0.0000` if $0/$0 or the real rate if verified).
4. Optional doc update: `01-D-SUMMARY.md:185` and `01-VERIFICATION.md:108` still assert the old wire contract — out of scope for this plan (those are planning artifacts, not runtime).

## Success criteria

- After any chat reply, the header CostCounter shows a non-zero USD value (or stays at `~$0.0000` if opencode-go/hy3 is genuinely $0/$0 — both are correct, the symptom "stuck at $0.0000 because the wire never carried usage" is fixed).
- modelId flows from worker start chunk → messages[].metadata.modelId → CostCounter prop.
- data-usage DataUIMessageChunk flows from step-finish → messages[].parts[].data → CostCounter sum.
- estimateCostUsd never throws on a missing pricing key.
- No regression on the audit INSERT path (`patchTokens` still runs).
- No regression on the existing text/tool-call/finish SSE branches.

## Output

Create `.planning/phases/01-foundation/01-P-SUMMARY.md` when done.
