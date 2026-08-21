---
status: diagnosed
trigger: "Gap G-1-10: Cost counter stays at $0 after agent replies — user flagged two plausible causes (step-finish totalUsage zero/missing; lib/pricing.ts missing opencode-go/hy3)."
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: Three independent defects stack. The user-reported pair (a)+(b) is incomplete — there is a third cause that is deeper and was mis-asserted by 01-D summary.
test: n/a — diagnosis only (goal: find_root_cause_only)
expecting: n/a
next_action: return ROOT CAUSE FOUND with the three-cause stack and a fix direction

## Symptoms

expected: Header CostCounter increments after each agent step as tokens_in/out flow in from step-finish chunks
actual: Cost counter stays at $0 after agent replies
errors: none observed (no TypeError, no NaN, no crash — silent $0)
reproduction: Send any chat message → check CostCounter in header stays $0.0000.
started: After G-1-6 model switch from nemotron → opencode-go/hy3. Predates the switch but masked by the $0/$0 nemotron entry.

## Eliminated

- hypothesis: "It's just one of (a) totalUsage missing or (b) pricing-table miss — pick one."
  evidence: Both are real, but a third cause is also blocking the symptom. The user's binary picks the symptom-shape but misses the wire-protocol layer.
  timestamp: 2026-08-20

- hypothesis: "estimateCostUsd returns NaN when PRICING[model] is undefined."
  evidence: `lib/pricing.ts:27` reads `const p = PRICING[model];` and immediately accesses `p.inputPerMTok` on the next line — that throws `TypeError: Cannot read properties of undefined (reading 'inputPerMTok')`, not NaN. (No arithmetic on `undefined` happens; the property-access line throws first.) But in practice `CostCounter` never calls `estimateCostUsd` with `"opencode-go/hy3"` anyway — see Cause 2.
  timestamp: 2026-08-20

- hypothesis: "Step-finish's totalUsage payload is zero from opencode-go/hy3."
  evidence: Plausible (some providers omit usage), but unobservable from the symptom — the worker SSE translator never emits any chunk carrying usage, so even a non-zero payload would never reach the browser.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: lib/pricing.ts (full read)
  found: `ModelId = "nemotron-3-ultra-free" | "deepseek-v4-flash"`. PRICING entry for nemotron is `{ inputPerMTok: 0, outputPerMTok: 0 }` — mathematically $0 regardless of tokens. No `opencode-go/hy3` entry.
  implication: If anyone passed `"opencode-go/hy3"` to `estimateCostUsd`, TypeScript rejects (union doesn't include it); at runtime `PRICING[model]` is undefined → line 28 throws TypeError on `p.inputPerMTok`. But nobody is passing it — see Cause 2.

- timestamp: 2026-08-20
  checked: app/components/CostCounter.tsx (full read)
  found: Default `model = "nemotron-3-ultra-free"`. Reads `m.usage?.inputTokens ?? 0` per message; computes `(tokensIn * 0 + tokensOut * 0) / 1_000_000 = 0`. Renders `~ $0.0000`.
  implication: Even if the worker forwarded non-zero tokens, the Counter is hard-wired to the $0/$0 model — would still display $0.0000.

- timestamp: 2026-08-20
  checked: app/components/ChatPanel.tsx:170 (CostCounter mount)
  found: `<CostCounter messages={messages as unknown as ...} />` — no `model` prop. The default wins.
  implication: Cause 2 confirmed at the call site.

- timestamp: 2026-08-20
  checked: worker/src/index.ts:71-202 (stream route), particularly 164-175 (step-finish branch)
  found: step-finish branch reads `chunk.payload.totalUsage` and calls `patchTokens(sessionId, lastToolName, inputTokens, outputTokens)` server-side. No `controller.enqueue(...)` line emits any `data:` chunk carrying usage. Branches before step-finish emit `start`, `text-start/-delta/-end`, `tool-input-available`, `tool-approval-request`, `tool-output-available`. The stream ends with `{type:"finish"}` + `data: [DONE]`.
  implication: Usage is consumed for audit_log server-side but never crosses the wire to the browser.

- timestamp: 2026-08-20
  checked: node_modules/ai/dist/index.d.ts (UIMessage + UIMessageChunk definitions)
  found: `interface UIMessage { id, role, metadata?, parts }` — **NO `usage` field**. `UIMessageChunk.finish-step` is `{type:'finish-step'}` with no usage field. The wire-format chunk for usage is `DataUIMessageChunk` of shape `{type: 'data-usage', data: {inputTokens, outputTokens, totalTokens}, transient?: boolean}` — usage lands on `m.parts[i].data`, not `m.usage`.
  implication: The 01-D summary assertion "AI SDK v7 populates `messages[i].usage` after each stream completes" is factually wrong about the wire contract. `m.usage` is always `undefined` regardless of what the worker sends. Even a correctly-emitted `data-usage` chunk would not populate `m.usage` — only `m.parts`.

- timestamp: 2026-08-20
  checked: ~/.claude/projects/.../memory/ui-message-chunk-translation.md
  found: Explicit table row: `step-finish | payload.totalUsage.{inputTokens,outputTokens} | skip from SSE — read for patchTokens audit`. Confirms the design *intentionally* skips step-finish from SSE because the audit use case was the only consumer at the time.
  implication: Cause 3 is architectural (designed-out), not a forgotten handler.

## Resolution

root_cause: THREE independent defects stack. All three must be addressed for the CostCounter to tick:

(1) **Pricing table missing `opencode-go/hy3`** — `lib/pricing.ts:3,11-20` — `ModelId` union excludes the post-G-1-6 active model. If anyone passes `"opencode-go/hy3"`, TypeScript blocks it and runtime would throw `TypeError: Cannot read properties of undefined (reading 'inputPerMTok')` (NOT NaN, as the user hypothesized). User-named cause (b).

(2) **CostCounter defaults to the $0/$0 model** — `app/components/CostCounter.tsx:22` defaults `model = "nemotron-3-ultra-free"`, and `app/components/ChatPanel.tsx:170` does not override it. PRICING entry is `{ inputPerMTok: 0, outputPerMTok: 0 }`, so the counter is mathematically pinned to $0.0000 even if usage flowed. Hidden cause, not in the user's hypothesis.

(3) **Worker does not forward usage to the browser; CostCounter reads a non-existent property** — `worker/src/index.ts:164-175` consumes `step-finish.totalUsage` for server-side audit only and intentionally skips emitting any usage chunk (per the explicit ui-message-chunk-translation memory note). Independently: AI SDK v5's `UIMessage` interface has no `usage` field (only `id`, `role`, `metadata`, `parts`); the wire-format chunk for usage is `{type: 'data-usage', data: {inputTokens, outputTokens, totalTokens}}` which lands on `m.parts[i].data`, not `m.usage`. The 01-D summary's "AI SDK v7 populates `messages[i].usage`" claim is factually wrong about the wire contract. So `CostCounter`'s `m.usage` read returns `undefined` regardless of what the server sends. User-named cause (a).

fix: (Direction only — not applied.)
- Add `opencode-go/hy3` row to `PRICING` with verified pricing (free? or per-1M rates) and extend `ModelId` union. Add a runtime guard in `estimateCostUsd` so a missing key returns `0` and logs a warning instead of throwing — protects against future model drift. (Ponytail: single guard in the shared function beats guarding every caller.)
- Pass the active model id into `<CostCounter model={...} />` from ChatPanel. Source it from the agent config (worker/src/agents/sdlc.ts:23) — either expose via a `useReducedMotion`-style hook or add a `/api/health`-adjacent `/api/models` endpoint, or thread it through `useChat`'s `metadata`. Ponytail: the cheapest correct path is to thread the model string via the SSE `start` chunk's `messageMetadata` (read by `useChat` into `metadata`) and read `lastMessage.metadata?.modelId` in the Counter.
- In `worker/src/index.ts` step-finish branch, also `controller.enqueue(encoder.encode(\`data: ${JSON.stringify({ type: "data-usage", data: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) } })}\n\n\`))`. In `CostCounter`, change the read from `m.usage?.inputTokens` to `m.parts.find(p => p.type === "data-usage")?.data?.inputTokens` (or sum across all data-usage parts).
- Add a regression test: assert that after a chat reply, `m.parts` contains a `data-usage` part with non-zero tokens when the upstream reports usage (opencode-go/hy3 should report per Anthropic-aligned contract).

verification: (Direction only.) Static: `pnpm tsc --noEmit` — confirms `ModelId` union + `as unknown` casts still narrow correctly after the wire-protocol change. Runtime: smoke chat "hello", check Counter header shows `~ $0.0001` (or whatever 0.000n rounds to for hy3's tier); check audit_log row has tokens_in/out > 0 (already does server-side; wire-side is the new requirement). Regression: existing tests still pass; UI-06 still works.

files_changed:
- lib/pricing.ts
- worker/src/index.ts
- app/components/CostCounter.tsx
- app/components/ChatPanel.tsx
- worker/src/agents/sdlc.ts (if model id needs to be sourced/exposed from agent config)

## Prevention

The design claim that masked Cause 3 ("AI SDK v7 populates `messages[i].usage` after each stream completes") lives in `01-D-SUMMARY.md:185` and `01-VERIFICATION.md:108`. Both should be corrected. The real wire contract is documented in `~/.claude/.../memory/ui-message-chunk-translation.md`; `01-VERIFICATION.md:108` should reference that memory note rather than asserting wire behavior from memory.
