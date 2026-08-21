---
phase: 1
plan: Q
subsystem: persistence
tags: [gap-closure, G-1-11, UI-04, UI-08, pause-resume, chat-replay]
dependency_graph:
  requires: [01-D-01-13 (pause handler + sendBeacon wiring), 01-F (01-F2 sessionId hydrate)]
  provides: [01-Q1 (worker stores messages snapshot + GET endpoint), 01-Q2 (ChatPanel fetches + seeds useChat)]
  affects: [worker/src/api-routes/pause.ts, worker/src/index.ts, app/lib/pause-signal.ts, app/components/ChatPanel.tsx, app/api/messages/route.ts]
tech-stack:
  added: []
  patterns: [navigator.sendBeacon (Blob JSON), useEffect deps [sessionId, messages] (re-bind on each render to avoid stale closures), useRef mirror of messages for unload-time read, in-memory Map for worker snapshot, Next.js route → worker bearer-auth proxy]
key-files:
  created: [app/api/messages/route.ts]
  modified: [worker/src/api-routes/pause.ts, worker/src/index.ts, app/lib/pause-signal.ts, app/components/ChatPanel.tsx]
decisions:
  - "StoredMessage is structurally typed (no ai SDK import) so pause.ts does not pull the full SDK into a route handler — cast at the boundary."
  - "useEffect deps include messages alongside sessionId so beforeunload/visibilitychange handlers always close over the latest array — without this the first-render messages would ship forever."
  - "messagesRef + sync effect placed AFTER useChat (not before as in plan literal) — TDZ-safe; messagesRef.current is the latest snapshot, not a render-time read."
  - "useChat prop is `messages: initialMessages`, not `initialMessages` — @ai-sdk/react 2.0 ChatInit field is `messages`. Plan used shorthand."
  - "In-memory Map persistence only; PostgresStore-backed durable persistence is Phase 8 work."
metrics:
  duration: 6
  completed_date: "2026-08-21T00:03:20Z"
  tasks: 2
  commits: 2
  files_changed: 5
  lines_changed: 100
status: complete
actuals:
  tokens: 1000
  tasks: 2
  commits: 2
---

# Phase 1 Plan Q: G-1-11 Pause/Resume Chat Replay Summary

Closing **G-1-11** (major): pause-and-resume message replay across three co-dependent code paths. Worker pause handler now persists the messages snapshot alongside `pausedAt`; worker exposes a `GET /sessions/:id/messages` endpoint; browser beacon sends the messages array; ChatPanel fetches prior messages on mount and seeds `useChat`.

## What Shipped

### Task 01-Q1 — Worker: store messages + expose GET endpoint

**Commit:** `bd3cc48` — `fix(pause): store messages in suspendedRuns + add GET /sessions/:id/messages`

Three coordinated edits:

1. **`worker/src/api-routes/pause.ts`** — `SuspendedRun` Map value now `{pausedAt, messages: StoredMessage[]}`. `StoredMessage` is structural (no ai SDK import) — `id?, role?, parts?, metadata?` — cast at the boundary. Beacon handler reads `body.messages` and stores it (defaults to `[]` if missing). Exports `getSuspendedMessages(sessionId)` so the new endpoint reads the snapshot.

2. **`worker/src/index.ts`** — registers `GET /sessions/:id/messages` after the existing `suspendedListRoute`. Handler reads `getSuspendedMessages(sessionId) ?? []` and returns `{sessionId, messages}`. Import line updated: `pauseRoute, getSuspendedMessages` from `./api-routes/pause`.

3. **`app/lib/pause-signal.ts`** — `beaconPause(sessionId, messages: unknown[])` now serializes both fields into the Blob JSON. `usePauseOnUnload(sessionId, messages: unknown[])` hook signature takes messages, and the `useEffect` deps array is `[sessionId, messages]` so the handlers re-bind on every messages change — without this dep update, the first-render messages array would ship forever (stale-closure bug).

### Task 01-Q2 — ChatPanel: fetch + seed initialMessages

**Commit:** `e5f5dd1` — `fix(chat): fetch prior messages on mount + ship messages in pause beacon`

Three coordinated edits:

1. **`app/components/ChatPanel.tsx`** — added `initialMessages` state (defaults to `[]`); added `messagesRef` ref mirroring `messages` via a sync effect; wired `messages: initialMessages` into `useChat`; updated `usePauseOnUnload(sessionId, messagesRef.current)` to pass the ref (latest snapshot, not render-time); post-mount useEffect now fetches `/api/messages?sessionId=...` after a stored sessionId hydrates and calls `setInitialMessages` to seed useChat.

2. **`app/api/messages/route.ts`** (new) — Next.js proxy to the worker's `/sessions/:id/messages` endpoint. Bearer auth via `WORKER_SHARED_SECRET` env var. On error returns `{messages: []}` with HTTP 200 — graceful fallback when worker is offline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved messagesRef + sync effect AFTER useChat (TDZ fix)**
- **Found during:** Task 2 — `pnpm tsc --noEmit` reported `TS2448 / TS2454: Variable 'messages' used before its declaration`
- **Issue:** Plan literal placed `const messagesRef = useRef(...)` and `useEffect(() => { messagesRef.current = messages; }, [messages]);` BEFORE the `useChat` destructure of `messages`. Effect body references `messages` which doesn't exist yet in scope (TDZ).
- **Fix:** Moved the ref declaration + sync effect to AFTER the `useChat(...)` call. `messages` is now in scope when the effect body runs. Behavior identical — the ref is still read at unload time, not render time.
- **Files modified:** `app/components/ChatPanel.tsx`
- **Commit:** `e5f5dd1`

**2. [Rule 1 - Bug] Renamed useChat prop `initialMessages` → `messages`**
- **Found during:** Task 2 — `pnpm tsc --noEmit` reported `TS2353: Object literal may only specify known properties, and 'initialMessages' does not exist in type 'UseChatOptions<UIMessage>'`
- **Issue:** `@ai-sdk/react` 2.0 `UseChatOptions` type is `({chat: Chat} | ChatInit) & {experimental_throttle?, resume?}`. The seed-message field on `ChatInit` is named `messages`, not `initialMessages`. Plan used `initialMessages` as a shorthand name.
- **Fix:** Changed `initialMessages,` → `messages: initialMessages,` in the `useChat` options. The state variable stays named `initialMessages` for clarity; only the property name passed to `useChat` matches the actual SDK type.
- **Files modified:** `app/components/ChatPanel.tsx`
- **Commit:** `e5f5dd1`

### Pre-existing TS errors (NOT introduced by this plan)

Per STATE.md carryover note: `lib/insforge.ts` has 2 pre-existing errors (`InsforgeClient` export name, `serviceKey` config field). These were present before 01-Q and are NOT included in the success criteria's "introduces no new errors" check. They are tracked for post-Phase-1 cleanup.

## Verification

All plan acceptance criteria met:

- `grep 'interface SuspendedRun' worker/src/api-routes/pause.ts` — 1 match
- `grep 'export function getSuspendedMessages' worker/src/api-routes/pause.ts` — 1 match
- `grep '"/sessions/:id/messages"' worker/src/index.ts` — 1 match
- `grep 'beaconPause(sessionId, messages)' app/lib/pause-signal.ts` — 2 matches (both call sites)
- `grep 'usePauseOnUnload(sessionId: string, messages: unknown\[\])' app/lib/pause-signal.ts` — 1 match
- `grep 'useRef' app/components/ChatPanel.tsx` — 1 match
- `grep 'messagesRef.current' app/components/ChatPanel.tsx` — 2 matches (declared + read by hook)
- `grep 'usePauseOnUnload(sessionId, messagesRef.current)' app/components/ChatPanel.tsx` — 1 match
- `grep 'fetch(\`/api/messages?sessionId=' app/components/ChatPanel.tsx` — 1 match
- `grep 'initialMessages' app/components/ChatPanel.tsx` — 3 matches
- `grep 'export async function GET' app/api/messages/route.ts` — 1 match
- `pnpm tsc --noEmit` — no new errors (only the 2 pre-existing `lib/insforge.ts` errors)

## Success Criteria

- [x] Worker `pause` handler accepts a `messages` array on the beacon payload and stores it in `suspendedRuns` Map alongside `pausedAt` — DONE
- [x] Worker exposes `GET /sessions/:id/messages` route returning the stored messages as `{messages: UIMessage[]}` — DONE
- [x] Browser beacon payload includes `messages: messagesRef.current` at `beforeunload` time — DONE
- [x] `ChatPanel` post-mount effect (after sessionId hydrate) fetches `/api/messages?sessionId=...` and seeds `useChat`'s `initialMessages` — DONE
- [x] `pnpm tsc --noEmit` introduces no new errors — DONE (pre-existing `lib/insforge.ts` errors unchanged)
- [ ] Live: close the tab, reopen it; prior chat messages reappear in the panel — DEFERRED to UAT (manual verify)
- [x] Implements UI-04 (session persists across refresh), UI-08 (session resumes where it left off)

## Known Limitations / Out of Scope

- **In-memory Map only.** Worker Map entries are lost on worker restart. Phase 8 will add PostgresStore-backed durable persistence.
- **Per-tab only.** No cross-device sync (per PROJECT.md "Out of Scope" — per-tab sessions only).
- **No token-eviction.** Map can grow indefinitely in long-running sessions (single-user demo — no production impact).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | Beacon payload is operator-authored; bearer auth enforced by Next → worker hop. No new attack surface beyond what already existed for `{sessionId}` payload. |
