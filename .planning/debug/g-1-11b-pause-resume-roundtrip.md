---
status: diagnosed
trigger: "G-1-11b — after close+reopen, chat panel stays empty despite GET /api/messages 200 returning prior messages"
created: 2026-08-20
updated: 2026-08-20
---

## Current Focus

hypothesis: ChatPanel constructs useChat with `messages: initialMessages` before the mount-fetch resolves; AI SDK v5 useChat only honors `messages` as initial seed at first construction, so the fetched snapshot is dropped.
test: trace render order — useState init vs mount-effect fetch vs useChat construction.
expecting: changing `initialMessages` after useChat is already built has no effect on the internal messages array.
next_action: return diagnosis (goal: find_root_cause_only).

## Symptoms

expected: User sends messages, closes tab, reopens within 30s, sees prior messages restored.
actual: POST /api/pause 200, GET /api/messages?sessionId=… 200, sessionId persists in localStorage — but chat panel stays empty after reopen.
errors: none.
reproduction: Test 11 — send 1-2 messages, close tab, reopen.
started: Discovered 2026-08-20 during UAT retest after 01-Q.

## Eliminated

- hypothesis: (b) Worker doesn't store messages from beacon into suspendedRuns.
  evidence: `worker/src/api-routes/pause.ts:49-54` parses `c.req.json()` and calls `suspendedRuns.set(sessionId, { pausedAt, messages: Array.isArray(body.messages) ? body.messages : [] })`. Storage path is correct.
  timestamp: 2026-08-20
- hypothesis: Worker /sessions/:id/messages returns empty regardless of stored snapshot.
  evidence: `worker/src/index.ts:48-55` reads `getSuspendedMessages(sessionId) ?? []` and wraps in `{ sessionId, messages }`. Next proxy at `app/api/messages/route.ts:14-18` forwards to it and returns the body verbatim.
  timestamp: 2026-08-20

## Evidence

- timestamp: 2026-08-20
  checked: `app/components/ChatPanel.tsx`
  found: Lines 85, 99, 131-148 — `useChat` is constructed with `messages: initialMessages` (line 99). `initialMessages` is `useState<UIMessage[]>([])` (line 85). Mount effect (line 131) fires the fetch and calls `setInitialMessages(body.messages)`. But `useChat`'s `messages` option is the initial seed — captured once at hook construction. Subsequent prop changes do not update the internal messages array (this is standard React hook semantics; useChat does not re-read the prop on each render).
  implication: Even if /api/messages returns a non-empty array, the fetched messages never enter useChat's state. Panel renders empty. **This is the primary root cause.**

- timestamp: 2026-08-20
  checked: `app/lib/pause-signal.ts` + ChatPanel render order
  found: Lines 39-53 — `usePauseOnUnload(sessionId, messages)` registers beforeunload + visibilitychange handlers whose closure captures `messages` from the prop. ChatPanel line 115 passes `messagesRef.current`. The ref is updated by an effect at line 101 (`useEffect(() => { messagesRef.current = messages; }, [messages])`) that runs AFTER render. So during any render, `messagesRef.current` is stale by one render cycle, and `usePauseOnUnload`'s own effect re-registers the handler using the value captured at render time (also one cycle behind). The beacon closure therefore misses the most recent message(s).
  implication: Beacon payload may carry an empty/stale `messages` array, so even if suspect (c) is fixed, the worker would still receive [] for that session on the next pause. **This is a secondary bug** — it doesn't by itself explain "panel empty after reopen" (since the worker stores whatever the beacon sent), but it would prevent the round-trip from being useful after a longer chat.

## Resolution

root_cause: ChatPanel constructs `useChat({ messages: initialMessages })` at first render when `initialMessages` is still `[]` (the useState default), then the mount effect fetches prior messages and calls `setInitialMessages(...)`. AI SDK v5 useChat treats `messages` as the initial seed — the prop is only honored on first hook construction. The fetched snapshot is silently dropped, so the panel renders empty after reopen regardless of what /api/messages returns.

fix: seed useChat with the fetched messages BEFORE the hook runs, OR use `setMessages` from useChat after the fetch, OR remount via `key={sessionId}` so useChat is re-initialized with the loaded snapshot. Smallest diff: gate useChat construction behind a `loaded` flag (don't render the panel until the fetch settles, then render with `messages: initialMessages`). This also fixes the beacon-staleness side effect (the ref will be populated at the moment of unload since the panel only mounts once messages are loaded).

verification: After fix, reopen tab within 30s of sending messages — chat panel renders the prior messages. Existing pause/resume path (POST /api/pause → worker store → GET /sessions/:id/messages) is unchanged; only the seed wiring on the client moves.

files_changed: []
