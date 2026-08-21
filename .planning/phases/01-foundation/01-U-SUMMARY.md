---
phase: 01-foundation
plan: U
subsystem: ui
tags: [chat, ai-sdk, session-id, audit-log, useChat, DefaultChatTransport]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "ChatPanel.tsx with useChat + DefaultChatTransport; post-mount setSessionId hydration (01-F2); module-scope currentSessionId carrier for audit (01-R)"
provides:
  - "DefaultChatTransport body is a function form so resolve() re-reads React closure on every sendMessage"
  - "Post-mount setSessionId(fresh) propagates to /api/chat POSTs"
  - "Worker setAuditSessionId receives the real browser sessionId for chat requests (was '' → 'anon')"
affects: [01-V, 01-W, 01-X, 01-Y, 01-Z, verify-work-1]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 242
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DefaultChatTransport body MUST be a function form when closure state (sessionId, approvalMode) changes post-construction"
    - "useRef in @ai-sdk/react captures Chat (and therefore transport) ONCE on first render; static body form is frozen for the Chat instance lifetime"

key-files:
  modified:
    - app/components/ChatPanel.tsx

key-decisions:
  - "Use arrow function form `() => ({ approvalMode, sessionId })` rather than re-instantiating the transport on every render (preserves chat history + tool-call state)"
  - "Do NOT change `as never` cast — pre-existing nominal type mismatch between `ai` DefaultChatTransport and `@ai-sdk/react` ChatTransport; unrelated to G-1-12b"
  - "Do NOT change `messages: initialMessages` line — 01-V owns the messages-loading flow; this fix is independent"

patterns-established:
  - "Pattern: when DefaultChatTransport body depends on React state that hydrates post-mount, use function form `body: () => ({ ... })` to defer evaluation to request time"

requirements-completed: [UI-04, BCK-04]

coverage:
  - id: D1
    description: "DefaultChatTransport body is a function form `body: () => ({ approvalMode, sessionId })` — the static object form is removed; useChat construction is otherwise unchanged (preserves `as never` cast and `messages: initialMessages`)."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "grep -nE 'body:\\s*\\(\\)\\s*=>\\s*\\(\\{.*approvalMode.*sessionId' app/components/ChatPanel.tsx → 1 match; ! grep -nE 'body:\\s*\\{\\s*approvalMode,\\s*sessionId\\s*\\}' app/components/ChatPanel.tsx → no match; grep 'useChat<UIMessage>(' app/components/ChatPanel.tsx → 1 match"
        status: pass
    human_judgment: false
  - id: D2
    description: "TypeScript introduces no new errors in ChatPanel.tsx (pre-existing 7 errors in lib/insforge.ts are unrelated and unchanged)."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "pnpm tsc --noEmit 2>&1 | grep ChatPanel → empty (no ChatPanel errors); lib/insforge.ts errors (TS2724 + TS2353) are pre-existing and not touched by this fix"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live end-to-end: browser sessionId propagates to audit_log.session_id for chat-driven tool calls (was 'anon' because captured transport held sessionId='' for Chat lifetime)."
    requirement: "BCK-04"
    verification:
      - kind: manual_procedural
        ref: "pnpm dev; trigger 'use echo to say hello'; SELECT session_id, tool_name FROM audit_log WHERE tool_name='echo' ORDER BY ts DESC LIMIT 1 → session_id matches browser Session: sess-... header (not 'anon')"
        status: unknown
    human_judgment: true
    rationale: "Live DB query requires pnpm dev + worker running + browser session; cannot be automated inside this executor (no live env in plan-execution context). The static grep + typecheck checks above establish the fix landed; the live DB row check is the operator's UAT step."

# Metrics
duration: 5min
completed: 2026-08-21
status: complete
---

# Phase 01 Plan U: DefaultChatTransport body → function form — propagate post-mount sessionId

**One-line fix to `app/components/ChatPanel.tsx` that closes G-1-12b: post-mount `setSessionId(fresh)` now reaches the worker's audit session for every `sendMessage` call, so `audit_log.session_id` for chat-driven tool calls carries the real browser session id (no longer `'anon'`).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-21T14:58:07Z
- **Completed:** 2026-08-21T15:03:20Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Closed G-1-12b (audit log empty for chat-driven tool calls): the captured transport no longer freezes `sessionId=""` for the Chat instance lifetime.
- Established a reusable pattern: any `DefaultChatTransport.body` that depends on post-mount React state must use the function form `body: () => ({ ... })` to defer evaluation to request time via `resolve()`.
- Zero collateral changes: `as never` cast preserved, `messages: initialMessages` preserved, worker/src/index.ts untouched, no new tsc errors.

## Task Commits

1. **Task 01-U1: DefaultChatTransport body function form** - `c469f7c` (fix)

**Plan metadata:** pending (final docs commit below)

## Files Created/Modified

- `app/components/ChatPanel.tsx` — single-line edit at line 97 (now 103): `body: { approvalMode, sessionId }` → `body: () => ({ approvalMode, sessionId })`, with an inline ponytail comment documenting the rationale (useRef captures Chat once; static object form is frozen; function form re-reads the closure).

## Decisions Made

None - followed plan as specified. The plan was deliberately scoped to the single-line client fix; the worker side at `worker/src/index.ts:89-93` already destructures `sessionId` from body correctly (per 01-R) and was explicitly excluded from this plan.

## Deviations from Plan

None - plan executed exactly as written. The pre-existing `lib/insforge.ts` tsc errors (TS2724 + TS2353) are unrelated to this fix and were not touched; they remain on the 01-E carryover list for post-Phase-1 cleanup.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The fix is purely client-side and changes no API contract, env var, or DB schema.

## Next Phase Readiness

- G-1-12b closed. The remaining Phase 1 gap-closure batch is 01-V, 01-W, 01-X, 01-Y, 01-Z.
- `pnpm dev` + a live `audit_log` query is the operator's UAT step for D3 (live DB row check) — out of executor scope.
- All static verify checks (grep for function form, absence of static form, useChat structure intact) passed. `pnpm tsc --noEmit` shows no new ChatPanel errors.

---
*Phase: 01-foundation*
*Completed: 2026-08-21*
