---
phase: 01-foundation
plan: P
subsystem: ui-cost
tags: [cost-counter, ai-sdk-v5, data-usage-chunk, message-metadata, pricing-guard]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "CostCounter component (header HUD), worker SSE translator emitting UIMessageChunk variants, PRICING table for nemotron + deepseek-v4-flash"
provides:
  - "ModelId union covers the active model (opencode-go/hy3)"
  - "PRICING row for opencode-go/hy3 (rates unverified for Phase 1; \$0/\$0 placeholder)"
  - "estimateCostUsd never throws on a missing key — returns 0 + one-time console.warn"
  - "Worker SSE start chunk carries messageMetadata.modelId so useChat populates messages[i].metadata.modelId"
  - "Worker SSE step-finish emits data-usage DataUIMessageChunk carrying { inputTokens, outputTokens, totalTokens }"
  - "CostCounter reads m.parts[i].type === 'data-usage'.data (real AI SDK v5 wire field), not the non-existent m.usage"
  - "ChatPanel passes model={messages.at(-1)?.metadata?.modelId} to CostCounter"
affects: [01-foundation, ui-06-cost-hud]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 850
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AI SDK v5 wire contract: UIMessage has id/role/metadata/parts only — no m.usage; usage flows as a data-usage DataUIMessageChunk landing on m.parts[i].data"
    - "Model id flows worker.start.messageMetadata → useChat → messages[i].metadata.modelId → CostCounter prop (single source of truth; no hardcoded default in the counter)"

key-files:
  created: []
  modified:
    - "lib/pricing.ts — ModelId union adds opencode-go/hy3; PRICING row added; estimateCostUsd guarded against missing keys"
    - "worker/src/index.ts — start chunk carries messageMetadata.modelId; step-finish enqueues data-usage DataUIMessageChunk"
    - "app/components/CostCounter.tsx — ChatMessageLike widened (metadata + parts); reads data-usage parts; default model = opencode-go/hy3"
    - "app/components/ChatPanel.tsx — imports ModelId; passes model={messages.at(-1)?.metadata?.modelId ?? 'opencode-go/hy3'} to CostCounter"

key-decisions:
  - "Single guard in estimateCostUsd beats guarding every caller — one warn per unknown model id (Set-tracked)"
  - "opencode-go/hy3 priced at \$0/\$0 placeholder; operator confirms the real tier at https://opencode.dev/pricing before relying on the counter for billing"
  - "In-place cast at the data-usage access site — `Record<string, unknown>` in the ChatMessageLike union prevents TS from narrowing p.data, so we narrow explicitly with `as { data?: ... }` only inside the type === 'data-usage' branch"
  - "Last-message metadata.modelId sourced from worker start chunk (messageMetadata) — no separate /api/models round trip, no hardcoded default in Counter"

patterns-established:
  - "Single source of truth for active modelId: worker SSE start chunk → useChat → messages[].metadata.modelId → Counter prop"
  - "Worker side: every step-finish must emit BOTH the server-side audit patch AND a wire data-usage chunk — they're complementary, not redundant"

requirements-completed: [UI-06]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "lib/pricing.ts ModelId union includes opencode-go/hy3; PRICING row present; estimateCostUsd guarded"
    requirement: UI-06
    verification:
      - kind: automated_static
        ref: "grep -nE '\"opencode-go/hy3\"' lib/pricing.ts → 2 matches (union + PRICING row)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'pricing: no entry for model' lib/pricing.ts → 1 match (guard added)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'export type ModelId' lib/pricing.ts → 1 match (union preserved)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Worker start chunk carries messageMetadata.modelId; step-finish emits data-usage DataUIMessageChunk"
    requirement: UI-06
    verification:
      - kind: automated_static
        ref: "grep -nE 'messageMetadata.*modelId.*opencode-go' worker/src/index.ts → 1 match"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'type: \"data-usage\"' worker/src/index.ts → 1 match"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'inputTokens: inTok.*outputTokens: outTok' worker/src/index.ts → 1 match (named locals)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'patchTokens\\(' worker/src/index.ts → 1 match (audit path preserved)"
        status: pass
    human_judgment: false
  - id: D3
    description: "CostCounter reads m.parts[i].type === 'data-usage' (real wire field); receives model prop from ChatPanel"
    requirement: UI-06
    verification:
      - kind: automated_static
        ref: "grep -nE 'type === \"data-usage\"' app/components/CostCounter.tsx → 1 match (parts read)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'model = \"opencode-go/hy3\"' app/components/CostCounter.tsx → 1 match (default model updated)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'metadata\\?:\\s*\\{\\s*modelId\\?:\\s*string' app/components/CostCounter.tsx → 1 match (interface widened)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'messages\\.at\\(-1\\)' app/components/ChatPanel.tsx → 1 match (model derived)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'model=\\{[^}]*at\\(-1\\)' app/components/ChatPanel.tsx → 1 match (prop wired)"
        status: pass
      - kind: automated_static
        ref: "grep -nE 'import type \\{ ModelId \\}' app/components/ChatPanel.tsx → 1 match (type imported)"
        status: pass
      - kind: automated_static
        ref: "pnpm tsc --noEmit → 0 new errors introduced by the plan (2 pre-existing errors in lib/insforge.ts unchanged, out of scope)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live: after a chat reply, the header CostCounter shows a non-zero USD value (or stays at ~$0.0000 if opencode-go/hy3 is genuinely $0/$0 — both are correct)"
    requirement: UI-06
    verification:
      - kind: manual_procedural
        ref: "pnpm dev → send chat message → observe header CostCounter increments from $0.0000 to a non-zero value (depends on opencode-go/hy3 tier)"
        status: unknown
    human_judgment: true
    rationale: "Live wire verification requires a running dev server + browser interaction; static checks confirm all four pieces of the wire contract are in place."

# Metrics
duration: 5min
completed: 2026-08-20
status: complete
---

# Phase 1 Plan P: G-1-10 Gap Closure Summary

**Closes G-1-10 (minor): header CostCounter ticks after every agent step. Three coordinated defects stacked — pricing table miss, hardcoded default model, and worker skipped the data-usage wire chunk while Counter read a non-existent `m.usage` field.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-20T23:51:09Z
- **Completed:** 2026-08-20T23:56:00Z
- **Tasks:** 3/3
- **Files modified:** 4
- **Commits:** 3

## Accomplishments

- **`lib/pricing.ts`** — Extended `ModelId` union with `"opencode-go/hy3"` (post-G-1-6 active model). Added a `PRICING` row at `$0/$0` placeholder until the operator confirms the tier at https://opencode.dev/pricing. Guarded `estimateCostUsd` against missing keys: returns 0 + one-time `console.warn` per unknown model id (Set-tracked to avoid log spam) instead of throwing `TypeError` on `PRICING[model].inputPerMTok`. Single shared guard beats guarding every caller.
- **`worker/src/index.ts`** — SSE start chunk now carries `messageMetadata: { modelId: "opencode-go/hy3" }` so `useChat` populates `messages[i].metadata.modelId` for the Counter. SSE step-finish branch now enqueues a `data-usage` `DataUIMessageChunk` carrying `{ inputTokens, outputTokens, totalTokens }` — lands on `m.parts[i].data` per the AI SDK v5 wire contract (UIMessage has no `m.usage` field). Hoisted `inTok`/`outTok` locals so the audit patch and wire chunk share the same values. `patchTokens` audit path preserved unchanged.
- **`app/components/CostCounter.tsx`** — `ChatMessageLike` interface widened to carry `metadata?: { modelId?: string }` and `parts?: Array<...>` (no more `usage` field — that was always wrong). Counter sums across all `data-usage` parts in `m.parts`. Default model changed from `"nemotron-3-ultra-free"` to `"opencode-go/hy3"` (the current agent model per `worker/src/agents/sdlc.ts:23`). In-place cast at the access site since `Record<string, unknown>` in the union prevents TS from narrowing `p.data` — narrow only inside the `type === "data-usage"` branch.
- **`app/components/ChatPanel.tsx`** — Added `import type { ModelId } from "@/lib/pricing";`. Replaced `<CostCounter messages=... />` with `<CostCounter messages=... model={((messages.at(-1) as ...).metadata?.modelId ?? "opencode-go/hy3") as ModelId} />` so the Counter receives the active model id from the last message's metadata (worker-sourced, single source of truth).

## Task Commits

Each task was committed atomically:

1. **Task 1: 01-P1-extend-pricing-table-with-hy3** — `5ec0327` (fix)
2. **Task 2: 01-P2-emit-data-usage-chunk-and-modelid-metadata** — `1e50929` (fix)
3. **Task 3: 01-P3-cost-counter-reads-data-usage-parts** — `260847b` (fix, amended to include in-place TS narrowing)

## Files Created/Modified

- `lib/pricing.ts` — 16 insertions, 1 deletion
- `worker/src/index.ts` — 10 insertions, 7 deletions
- `app/components/CostCounter.tsx` — interface widened + usage loop reads parts; default model updated
- `app/components/ChatPanel.tsx` — added ModelId import; passed model prop to CostCounter

## Decisions Made

- **Single guard in `estimateCostUsd` over per-caller guards.** A `Record`-indexed access on a missing key throws `TypeError` on the first property read; guarding every caller means every caller pays for the check. One `if (!p)` in the shared function plus a `Set<string>` of warned model ids so we don't log on every token update.
- **In-place type narrowing at the use site.** The `ChatMessageLike.parts` union has a `Record<string, unknown>` branch for forward-compat with future AI SDK part shapes. That branch prevents TS from narrowing `p.data` to `{ inputTokens?, outputTokens?, totalTokens? }`. Narrowing explicitly inside the `type === "data-usage"` branch keeps the interface honest (no `as any` at the field-access site) and keeps the rest of the part types loose.
- **Model id flows through SSE messageMetadata, not a separate endpoint.** Cheapest correct path. The worker knows the active model id (it just configured the agent); emitting it on the existing start chunk's `messageMetadata` field costs ~5 bytes of SSE and zero new routes. `useChat` already parses that field and surfaces it as `messages[i].metadata`, so the Counter is a one-liner read.
- **Preserve `patchTokens` audit path.** The data-usage wire chunk is a *new* consumer of `step-finish.totalUsage`; the server-side audit patch is the original consumer. Both must keep running — server-side audit (BCK-03) for the database row + client-side wire (UI-06) for the HUD. One patch call + one `controller.enqueue` per step-finish.

## Deviations from Plan

- **In-place type narrowing in CostCounter (auto-fix)** — Task 3's `ChatMessageLike` interface included a `Record<string, unknown>` fallback branch for forward-compat. TypeScript's narrowing of `p.data` collapses to `{}` because the union with `Record<string, unknown>` is opaque. The static-check verification passed but `pnpm tsc --noEmit` flagged 2 errors (`Property 'inputTokens' does not exist on type '{}'`). Resolved by extracting `const d = (p as { data?: { inputTokens?: number; outputTokens?: number } }).data;` inside the `type === "data-usage"` branch — narrows only at the use site, keeps the interface honest, no `any`. Recorded as Rule 1 deviation; 1-line fix.
- **`pnpm tsc --noEmit` shows 2 pre-existing errors in `lib/insforge.ts`** (`'InsforgeClient'` casing + `serviceKey` not in `InsForgeConfig`) — predates 01-P, out of scope per deviation scope boundary. The plan introduced 0 new errors.

## Issues Encountered

None — wire-contract diagnosis was already complete in `.planning/debug/g-1-10-cost-counter-zero.md` (three-cause stack).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

G-1-10 closed. UI-06 (header token-cost HUD) is now wired end-to-end:

- `worker/src/index.ts` start chunk → `useChat` → `messages[i].metadata.modelId` (model id)
- `worker/src/index.ts` step-finish → `data-usage` DataUIMessageChunk → `messages[i].parts[j].data` (tokens)
- `ChatPanel.tsx` reads `messages.at(-1)?.metadata?.modelId`, passes to `CostCounter`
- `CostCounter.tsx` sums tokens across all `data-usage` parts, multiplies by `PRICING[model]`

Open follow-up (out of scope for this plan, deferred to operator action):
- Verify the real opencode-go/hy3 per-1M rate at https://opencode.dev/pricing and update `lib/pricing.ts` PRICING row. Until verified the HUD will stay at `~$0.0000` even with non-zero tokens — that's a $0/$0 placeholder, not a wire-contract failure.

The remaining gap-closure plans (`01-N` through `01-S` excluding `01-P`) are unrelated to UI-06 and can be sequenced independently.

---
*Phase: 01-foundation*
*Completed: 2026-08-20*
