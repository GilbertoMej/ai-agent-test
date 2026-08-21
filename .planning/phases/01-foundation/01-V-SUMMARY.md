---
phase: 01-foundation
plan: V
subsystem: ui
tags: [chat, ai-sdk, useChat, setMessages, session-resume, pause-resume, initial-seed]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "ChatPanel.tsx with useChat + DefaultChatTransport; mount-fetch of /api/messages; messagesRef mirror for usePauseOnUnload (01-Q); DefaultChatTransport body function form (01-U)"
provides:
  - "useChat's `messages` is seeded via setMessages after the mount-fetch resolves (one-shot `messages` prop is retired)"
  - "After close+reopen with a stored sessionId, the chat panel renders the prior messages on next render"
  - "Beacon-staleness side effect is closed: the ref mirror is in sync with the rendered messages at unload time"
affects: [01-W, 01-X, 01-Y, 01-Z, verify-work-1]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 1160
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AI SDK v5 useChat: the `messages` prop is the initial seed captured at hook construction; subsequent prop changes do not update the internal array. Use `setMessages` (UseChatHelpers at @ai-sdk/react/dist/index.d.ts:25) to mutate messages after mount."
    - "Pattern: when state needs to enter useChat after construction (fetched snapshot, programmatically inserted history), destructure `setMessages` and call it inside the .then handler. No `loaded` gate, no `key={...}` remount, no parent-fetch migration."

key-files:
  modified:
    - app/components/ChatPanel.tsx

key-decisions:
  - "Option (a) from the diagnosis — use setMessages inside the existing .then handler. Smaller diff than a `loaded` gate (no extra state, no conditional render) and a `key={...}` remount (no chat-history reset)."
  - "Drop the `initialMessages` useState entirely. It was only consumed by the seed prop; with the seed prop retired, the state is dead weight."
  - "Add setMessages to the mount-effect dep array. It is a stable reference across renders (useChat returns the same setter), but listing it documents the dependency and satisfies react-hooks/exhaustive-deps if enabled."
  - "Do NOT change the mount-fetch call itself, the JSX rendering of `messages`, usePauseOnUnload, decide(), or app/api/messages/route.ts. Scope was deliberately narrow — only the seed wiring on the client moves."

patterns-established:
  - "Pattern: for any state that should enter useChat's messages array AFTER mount, destructure `setMessages` from useChat and call it inside the .then (or any async) handler. The hook re-renders with the populated array."

requirements-completed: [UI-04]

coverage:
  - id: D1
    description: "ChatPanel destructures setMessages from useChat and calls it inside the mount-fetch's .then handler with the fetched snapshot."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "grep -nE 'setMessages' app/components/ChatPanel.tsx | grep -v '^[[:space:]]*//' | grep -c . → 8 matches (destructure on line 100 + call on line 153 + comment lines 92,94,95,97,139,140)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ChatPanel no longer seeds useChat via the `messages` prop on construction (the prop is one-shot — see UseChatHelpers at @ai-sdk/react/dist/index.d.ts:25 for setMessages)."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "useChat<UIMessage> call site (lines 100-105) has no `messages:` key; `initialMessages` useState is removed; the only `initialMessages` token left in the file is in a doc comment (line 92) explaining the drop"
        status: pass
    human_judgment: false
  - id: D3
    description: "01-U's body function form is preserved (no regression on the G-1-12b fix)."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "grep -nE 'body:\\s*\\(\\)\\s*=>\\s*\\(\\{.*approvalMode.*sessionId' app/components/ChatPanel.tsx → 1 match (line 103)"
        status: pass
    human_judgment: false
  - id: D4
    description: "TypeScript introduces no new errors in ChatPanel.tsx (pre-existing errors in lib/insforge.ts remain out-of-scope per 01-E carryover list)."
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "pnpm tsc --noEmit 2>&1 | grep ChatPanel → empty (no ChatPanel errors); only 2 pre-existing errors remain in lib/insforge.ts (TS2724 + TS2353) — unrelated to this fix"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live end-to-end: after close+reopen of the tab with the same sessionId, prior chat messages reappear in the panel."
    requirement: "UI-04"
    verification:
      - kind: manual_procedural
      - ref: "pnpm dev; send 2 chat messages; close the tab (POST /api/pause fires with messages); reopen within 30s; the chat panel renders the 2 prior messages above the input. Test 11 in 01-UAT.md was blocked on this code path; once 01-V lands, Test 11 must pass with a live observation."
      - status: unknown
    human_judgment: true
    rationale: "Live end-to-end requires pnpm dev + worker running + browser session; cannot be automated inside this executor (no live env in plan-execution context). The static grep + typecheck checks above establish the fix landed; the live round-trip is the operator's UAT step."

# Metrics
duration: 9min
completed: 2026-08-21
status: complete
---

# Phase 01 Plan V: useChat loads fetched messages via setMessages after fetch resolves

**Three coordinated edits to `app/components/ChatPanel.tsx` that close G-1-11b: after close+reopen, the chat panel now renders the prior messages (the `messages` prop is one-shot; `setMessages` is the only post-construction seed).**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-21T15:03:20Z (post 01-U completion)
- **Completed:** 2026-08-21T15:12:28Z
- **Tasks:** 1
- **Files modified:** 1
- **Commits:** 1 (fix) + 1 (docs, below)

## Accomplishments

- Closed G-1-11b (major): after close+reopen, the chat panel now renders the prior messages on next render. AI SDK v5 useChat's `messages` prop is the initial seed captured at hook construction; subsequent prop changes are silently dropped. The fix uses `setMessages` (UseChatHelpers at `@ai-sdk/react/dist/index.d.ts:25`) to push the fetched snapshot into the hook's internal array inside the mount-fetch's `.then` handler.
- Closed the secondary "beacon staleness" bug: by the time the user closes the tab, `messagesRef.current` is in sync with the rendered messages (the fetch already settled and `setMessages` updated the hook's array; the ref-mirror effect fired on the new array).
- Established a reusable pattern: any state that should enter useChat's messages array AFTER mount goes through `setMessages`, never the `messages` prop. No `loaded` gate, no `key={...}` remount, no parent-fetch migration.
- Zero collateral changes: 01-U's `body: () => ({ approvalMode, sessionId })` function form preserved, the mount-fetch call itself unchanged, `app/api/messages/route.ts` untouched, no new tsc errors.

## Task Commits

1. **Task 01-V1: Gate useChat on prior-messages fetch via setMessages** - `b0086d7` (fix)

**Plan metadata:** pending (final docs commit below)

## Files Created/Modified

- `app/components/ChatPanel.tsx` — three coordinated edits in one file (23 insertions, 17 deletions):
  - **Edit 1** (lines 84-85): removed `const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);` (and the preceding 01-Q doc comment). The state was only consumed by the seed prop; with the seed prop retired, the state is dead weight.
  - **Edit 2** (lines 88-105): destructure `setMessages` from useChat; drop the `messages: initialMessages` seed prop. The useChat construction is now: `useChat<UIMessage>({ transport: new DefaultChatTransport({ api: "/api/chat", body: () => ({ approvalMode, sessionId }) }) as never })` — empty seed, function-form body preserved.
  - **Edit 3** (lines 132-160): inside the mount-fetch's `.then` handler, replaced `setInitialMessages(body.messages as UIMessage[])` with `setMessages(body.messages as UIMessage[])`. The fetched snapshot now flows into useChat's internal messages array. Added `setMessages` to the effect's dep array (stable reference; documents the dependency).
  - All other code paths (JSX rendering of `messages`, usePauseOnUnload, decide(), useRef mirror) preserved unchanged.

## Decisions Made

- **Option (a) from the diagnosis** — use `setMessages` inside the existing `.then` handler. Smaller diff than a `loaded` gate (no extra state, no conditional render) and a `key={...}` remount (no chat-history reset). The diagnosis at `.planning/debug/g-1-11b-pause-resume-roundtrip.md` listed three candidate fixes; option (a) is the minimum-scope change and the one called out by the plan.
- **Retire `initialMessages` entirely** rather than keep it as a no-op. Dead state is a footgun for future readers ("why is this here?"). The doc comment on the useChat call site (lines 92-97) records the rationale so the history is preserved.
- **Add `setMessages` to the mount-effect dep array.** useChat returns a stable setter reference across renders, so the effect won't refire — but listing the dependency documents the wiring and satisfies react-hooks/exhaustive-deps if enabled.

## Deviations from Plan

None - plan executed exactly as written. The 2 pre-existing `lib/insforge.ts` tsc errors (TS2724 + TS2353) are unrelated to this fix and remain on the 01-E carryover list for post-Phase-1 cleanup.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The fix is purely client-side and changes no API contract, env var, or DB schema. The fetch to `/api/messages?sessionId=...` was already in place from 01-Q; only the seed wiring on the client moves.

## Next Phase Readiness

- G-1-11b closed. The remaining Phase 1 gap-closure batch is 01-W, 01-X, 01-Y, 01-Z.
- `pnpm dev` + a live round-trip (send 2 messages, close tab, reopen within 30s) is the operator's UAT step for D5 (live behavioral check) — out of executor scope.
- All static verify checks passed: setMessages destructured + called inside .then; `initialMessages` state retired (only doc-comment mention remains); 01-U's body function form preserved (line 103); useChat construction otherwise intact.
- `pnpm tsc --noEmit` shows no new ChatPanel errors.

---
*Phase: 01-foundation*
*Completed: 2026-08-21*

## Self-Check: PASSED

- [x] `.planning/phases/01-foundation/01-V-SUMMARY.md` exists on disk
- [x] Commit `b0086d7` (fix(chat): gate useChat on prior-messages fetch) present in git log
- [x] Commit `b0086d7` parent `dacf676` (docs(01-U): append self-check pass to SUMMARY) present in git log
- [x] Final diff: ChatPanel.tsx +23/-17, single fix commit
- [x] Verify checks: setMessages count 8 (>= 2), initialMessages state retired (only 1 doc-comment mention), 01-U body function form preserved (1 match)
- [x] `pnpm tsc --noEmit` introduces no new ChatPanel errors (only 2 pre-existing lib/insforge.ts errors remain)
