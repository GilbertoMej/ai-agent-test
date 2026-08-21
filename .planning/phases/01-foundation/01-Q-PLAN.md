---
phase: 1
plan: Q
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-11]
depends_on: []
files_modified:
  - worker/src/api-routes/pause.ts
  - worker/src/index.ts
  - app/components/ChatPanel.tsx
  - app/lib/pause-signal.ts
  - app/api/messages/route.ts
autonomous: true
must_haves:
  - "Worker `pause` handler accepts a `messages` array on the beacon payload and stores them in the `suspendedRuns` Map alongside `pausedAt`"
  - "Worker exposes a `GET /sessions/:id/messages` route returning the stored messages as `{messages: UIMessage[]}`"
  - "Browser beacon payload includes `messages: messagesRef.current` (a ref to the latest messages array) at `beforeunload` time"
  - "`ChatPanel` post-mount effect (after sessionId hydrate) fetches `/api/messages?sessionId=...` and seeds `useChat`'s `initialMessages`"
  - "`pnpm tsc --noEmit` introduces no new errors"
  - "Live: close the tab, reopen it; prior chat messages reappear in the panel"
requirements:
  - UI-04
  - UI-08
---

# 01-Q — Phase 1 Gap Closure (pause/resume persists chat messages)

Closes G-1-11 (major): THREE co-dependent missing pieces (AND-gate) — fixing one without the others leaves the symptom intact.

(1) `worker/src/api-routes/pause.ts:13` — `suspendedRuns` Map value type is `{pausedAt:number}` with no `messages` field; beacon payload is `{sessionId}` only.
(2) No `GET /sessions/:id/messages` endpoint exists in `worker/src/api-routes/` — grep returns no hits for messages/persist/store/save.
(3) `app/components/ChatPanel.tsx:87` `useChat` has no `initialMessages`; post-mount useEffect (lines 107-125) only restores sessionId, no fetch.

Fix is THREE coordinated pieces across FIVE files. Ponytail: in-memory Map with messages snapshot on pause + GET endpoint that reads the Map + ChatPanel fetches on mount. Durable Postgres persistence is out of scope (Phase 8 work).

## Tasks

<task type="auto">
  <id>01-Q1-extend-suspended-runs-with-messages-and-add-messages-endpoint</id>
  <read_first>
    - worker/src/api-routes/pause.ts (full file — line 13 suspendedRuns Map value type)
    - worker/src/api-routes/resume.ts (full file — pattern for new suspendedListRoute on lines 28-31)
    - worker/src/index.ts (lines 42-67 — apiRoutes registration pattern with registerApiRoute)
    - app/lib/pause-signal.ts (line 13 — Blob payload construction; line 14 — sendBeacon URL)
  </read_first>
  <action>
    Three coordinated edits.

    **Edit 1 — `worker/src/api-routes/pause.ts`**: extend the Map value type with `messages`, accept them on the beacon, store them.

    Current lines 9-13:
    ```
    interface PausePayload {
      sessionId?: string;
    }

    const suspendedRuns = new Map<string, { pausedAt: number }>();
    ```

    Replacement:
    ```
    // UIMessage shape — keep this structural so pause.ts does not import ai's types
    // (which would pull the full SDK into a route handler). Cast at the boundary.
    interface StoredMessage {
      id?: string;
      role?: string;
      parts?: unknown[];
      metadata?: unknown;
    }

    interface PausePayload {
      sessionId?: string;
      messages?: StoredMessage[];
    }

    interface SuspendedRun {
      pausedAt: number;
      messages: StoredMessage[];
    }

    const suspendedRuns = new Map<string, SuspendedRun>();

    export function getSuspendedMessages(sessionId: string): StoredMessage[] | undefined {
      return suspendedRuns.get(sessionId)?.messages;
    }
    ```

    Then update the handler (currently lines 27-35) to read `messages` from the body and store them:

    Current:
    ```
    export const pauseRoute = registerApiRoute("/pause", {
      method: "POST",
      handler: async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as PausePayload;
        const sessionId = body.sessionId ?? "anon";
        suspendedRuns.set(sessionId, { pausedAt: Date.now() });
        return c.json({ ok: true, suspended: true, sessionId });
      },
    });
    ```

    Replacement:
    ```
    export const pauseRoute = registerApiRoute("/pause", {
      method: "POST",
      handler: async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as PausePayload;
        const sessionId = body.sessionId ?? "anon";
        suspendedRuns.set(sessionId, {
          pausedAt: Date.now(),
          messages: Array.isArray(body.messages) ? body.messages : [],
        });
        return c.json({ ok: true, suspended: true, sessionId });
      },
    });
    ```

    Two changes:
    1. Add `messages` field to the Map value type and store the array (default `[]` if missing).
    2. Export `getSuspendedMessages(sessionId)` so the new endpoint (Edit 2) can read the snapshot.

    **Edit 2 — New `messages` endpoint**: register `GET /sessions/:id/messages` in `worker/src/index.ts` apiRoutes (insert after the existing `suspendedListRoute` on line 46).

    New route block:
    ```
    registerApiRoute("/sessions/:id/messages", {
      method: "GET",
      handler: async (c) => {
        const sessionId = c.req.param("id") ?? "anon";
        const messages = getSuspendedMessages(sessionId) ?? [];
        return c.json({ sessionId, messages });
      },
    }),
    ```

    Also add the import at the top of `worker/src/index.ts` (next to the existing pauseRoute import on line 16):

    Current:
    ```
    import { pauseRoute } from "./api-routes/pause";
    ```

    Replacement:
    ```
    import { pauseRoute, getSuspendedMessages } from "./api-routes/pause";
    ```

    **Edit 3 — Beacon payload includes messages** (`app/lib/pause-signal.ts`). Currently the beacon sends only `{sessionId}`. Update `beaconPause` to accept a `messages` array and include it.

    Current lines 11-18:
    ```
    function beaconPause(sessionId: string): void {
      try {
        const blob = new Blob([JSON.stringify({ sessionId })], { type: "application/json" });
        navigator.sendBeacon?.("/api/pause", blob);
      } catch {
        /* ignore */
      }
    }
    ```

    Replacement:
    ```
    function beaconPause(sessionId: string, messages: unknown[]): void {
      try {
        const blob = new Blob([JSON.stringify({ sessionId, messages })], { type: "application/json" });
        navigator.sendBeacon?.("/api/pause", blob);
      } catch {
        /* ignore */
      }
    }
    ```

    Also update the hook signature (lines 39-53). Current:
    ```
    export function usePauseOnUnload(sessionId: string): void {
      useEffect(() => {
        if (typeof window === "undefined") return;
        const onBeforeUnload = () => beaconPause(sessionId);
        const onVisibility = () => {
          if (document.visibilityState === "hidden") beaconPause(sessionId);
        };
        ...
    ```

    Replacement:
    ```
    export function usePauseOnUnload(sessionId: string, messages: unknown[]): void {
      useEffect(() => {
        if (typeof window === "undefined") return;
        const onBeforeUnload = () => beaconPause(sessionId, messages);
        const onVisibility = () => {
          if (document.visibilityState === "hidden") beaconPause(sessionId, messages);
        };
        ...
      }, [sessionId, messages]);
    }
    ```

    The new parameter threads the messages array from the ChatPanel (caller) into the beacon. Stale-closure-safe: `useEffect` with `[sessionId, messages]` deps means the handler always sees the latest messages — the effect re-binds `beforeunload` and `visibilitychange` listeners every time `messages` changes so the closure captures the fresh array. (Without the dep update, the handlers would close over the first-render messages array and ship a stale snapshot on tab unload.)

    Do NOT change the existing `loadSessionId` / `saveSessionId` helpers (lines 20-36) — they are sessionId-only and unrelated to messages persistence.
  </action>
  <files>worker/src/api-routes/pause.ts, worker/src/index.ts, app/lib/pause-signal.ts</files>
  <verify>
    <automated>grep -nE 'interface SuspendedRun' worker/src/api-routes/pause.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'export function getSuspendedMessages' worker/src/api-routes/pause.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE '"/sessions/:id/messages"' worker/src/index.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'beaconPause\(sessionId, messages\)' app/lib/pause-signal.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && grep -nE 'usePauseOnUnload\(sessionId: string, messages: unknown\[\]\)' app/lib/pause-signal.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'interface SuspendedRun' worker/src/api-routes/pause.ts` returns 1 match (Map value type extended)
    - `grep 'export function getSuspendedMessages' worker/src/api-routes/pause.ts` returns 1 match (reader exported)
    - `grep '"/sessions/:id/messages"' worker/src/index.ts` returns 1 match (new GET route registered)
    - `grep 'beaconPause(sessionId, messages)' app/lib/pause-signal.ts` returns 2+ matches (both call sites updated)
    - `grep 'usePauseOnUnload(sessionId: string, messages: unknown[])' app/lib/pause-signal.ts` returns 1 match (hook signature updated)
    - `pnpm tsc --noEmit` introduces no new errors in pause.ts, index.ts, or pause-signal.ts
  </acceptance_criteria>
  <done>Worker pause handler stores messages in suspendedRuns; new GET /sessions/:id/messages endpoint reads them; beacon sends messages alongside sessionId.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04 (session persists across refresh), UI-08 (session resumes where it left off)</implements>
  <commit>fix(pause): store messages in suspendedRuns + add GET /sessions/:id/messages</commit>
</task>

<task type="auto">
  <id>01-Q2-chatpanel-fetches-messages-on-mount</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 87-92 — useChat declaration; lines 107-125 — post-mount useEffect; line 105 — usePauseOnUnload(sessionId) call)
    - app/lib/pause-signal.ts (full file — beaconPause + usePauseOnUnload signatures)
  </read_first>
  <action>
    Two coordinated edits in `app/components/ChatPanel.tsx`.

    **Edit A — Track messages via a ref** so the pause hook always sees the latest array (no stale-closure issue).

    Add near the top of the `ChatPanel` function body (after the `useState` declarations on lines 74-81 and before `useChat` on line 87):

    ```
    // Ref mirror of `messages` so usePauseOnUnload sees the latest array at unload time.
    const messagesRef = useRef<UIMessage[]>([]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    ```

    Also add `useRef` to the imports at the top: `import { useEffect, useRef, useState } from "react";` (replace the existing `import { useEffect, useState } from "react";` on line 5).

    **Edit B — Wire messages into the pause hook** (line 105).

    Current:
    ```
    usePauseOnUnload(sessionId);
    ```

    Replacement:
    ```
    usePauseOnUnload(sessionId, messagesRef.current);
    ```

    Note: `messagesRef.current` is the latest snapshot, kept in sync by the `useEffect` in Edit A. The pause hook reads it at unload time (not at render time) so the ref pattern is correct.

    **Edit C — Fetch prior messages on mount + seed initialMessages** (extend the existing post-mount useEffect at lines 121-125 and pass `initialMessages` to useChat on line 87).

    Replace the useEffect body (lines 121-125):
    ```
    useEffect(() => {
      if (typeof window === "undefined") return;
      const existing = loadSessionId(); if (existing) { setSessionId(existing); return; }
      const fresh = `sess-${Math.random().toString(36).slice(2, 10)}`; saveSessionId(fresh); setSessionId(fresh);
    }, []);
    ```

    With:
    ```
    useEffect(() => {
      if (typeof window === "undefined") return;
      const existing = loadSessionId();
      if (existing) {
        setSessionId(existing);
        // Fetch prior messages for this session; seed useChat's initialMessages.
        fetch(`/api/messages?sessionId=${encodeURIComponent(existing)}`)
          .then((r) => r.json() as Promise<{ messages?: unknown[] }>)
          .then((body) => {
            if (Array.isArray(body.messages)) {
              setInitialMessages(body.messages as UIMessage[]);
            }
          })
          .catch(() => { /* no prior messages — keep empty */ });
        return;
      }
      const fresh = `sess-${Math.random().toString(36).slice(2, 10)}`; saveSessionId(fresh); setSessionId(fresh);
    }, []);
    ```

    Add the `setInitialMessages` state (after the other `useState` calls on lines 79-81):

    ```
    const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
    ```

    And thread it into useChat on line 87. Current:
    ```
    const { messages, sendMessage, status } = useChat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: { approvalMode, sessionId },
      }) as never,
    });
    ```

    Replacement:
    ```
    const { messages, sendMessage, status } = useChat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: { approvalMode, sessionId },
      }) as never,
      initialMessages,
    });
    ```

    Three changes:
    1. Add `initialMessages` state, defaulting to `[]`.
    2. Pass `initialMessages` into `useChat`.
    3. The existing mount effect fetches prior messages from `/api/messages?sessionId=...` when a stored sessionId is found and calls `setInitialMessages` to seed the chat.

    Do NOT change the chat send path (lines 95-100) — `sendMessage` is unchanged. Do NOT change `decide` (lines 133-163) — approval flow is unchanged. Do NOT change the action feed rendering (lines 189-236).

    **Server-side wrapper note**: the new `/api/messages?sessionId=...` Next.js route at `app/api/messages/route.ts` is a thin proxy to the worker's `/sessions/:id/messages` endpoint. It does NOT exist yet — see the executor's note: this task creates the worker endpoint in 01-Q1; the Next.js wrapper at `app/api/messages/route.ts` is a separate tiny route to be added if it doesn't already exist. Since the spec says "all three must ship together" and this task creates the client fetch, the executor should ALSO add a minimal `app/api/messages/route.ts` Next proxy if missing.

    The minimal proxy (if not present, add to this task):
    ```
    import { NextResponse } from "next/server";
    export const runtime = "nodejs";
    export async function GET(req: Request) {
      const url = new URL(req.url);
      const sessionId = url.searchParams.get("sessionId") ?? "anon";
      const workerUrl = process.env.WORKER_URL ?? "http://localhost:4111";
      const secret = process.env.WORKER_SHARED_SECRET;
      try {
        const r = await fetch(`${workerUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = await r.json();
        return NextResponse.json(body);
      } catch (e) {
        return NextResponse.json({ messages: [] }, { status: 200 });
      }
    }
    ```
  </action>
  <files>app/components/ChatPanel.tsx, app/api/messages/route.ts</files>
  <verify>
    <automated>grep -nE 'import.*useRef' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'messagesRef\.current' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && grep -nE 'usePauseOnUnload\(sessionId, messagesRef\.current\)' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'fetch\(`/api/messages\?sessionId=' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'initialMessages' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && grep -nE 'export async function GET' app/api/messages/route.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'useRef' app/components/ChatPanel.tsx` returns 1+ match (ref imported)
    - `grep 'messagesRef.current' app/components/ChatPanel.tsx` returns 2+ matches (declared + read by hook)
    - `grep 'usePauseOnUnload(sessionId, messagesRef.current)' app/components/ChatPanel.tsx` returns 1 match (hook wired)
    - `grep 'fetch(`/api/messages?sessionId=' app/components/ChatPanel.tsx` returns 1 match (fetch on mount)
    - `grep 'initialMessages' app/components/ChatPanel.tsx` returns 2+ matches (state + useChat prop)
    - `grep 'export async function GET' app/api/messages/route.ts` returns 1+ match (Next proxy exists; either pre-existing or newly created)
    - `pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx or messages/route.ts
  </acceptance_criteria>
  <done>ChatPanel tracks messages via ref, ships them in the pause beacon, fetches prior messages on mount, and seeds useChat with them. Closing the tab then reopening restores the chat.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04 (session persists), UI-08 (resume)</implements>
  <commit>fix(chat): fetch prior messages on mount + ship messages in pause beacon</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Browser beacon → worker | sendBeacon payload is JSON. Operator-authored (no user-supplied strings). Bearer auth on /api/messages is enforced by the Next → worker hop. |
| Worker Map → browser GET | In-memory; no persistence across worker restart. Phase 8 durable persistence is out of scope. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-Q-01 | Information Disclosure | messages in beacon | low | accept | messages contain operator-typed chat; no secrets in the wire format. |
| T-1-Q-02 | Tampering | Cross-session bleed | low | mitigate | Map is keyed by sessionId; `useEffect([sessionId, messages])` dep ensures the beacon only fires with the latest per-session messages. |
| T-1-Q-03 | Denial of Service | Worker Map growth | low | accept | Single-user Phase 1; Map entries naturally cleared on resume (`clearSuspended` in resume.ts:18). Multi-user Phase should add TTL eviction. |

## Verification

1. Static: grep confirms pause.ts SuspendedRun extension + getSuspendedMessages export + new route registration + beacon signature + ChatPanel ref + initialMessages.
2. `pnpm tsc --noEmit` — no new errors.
3. Live: `pnpm dev`; send a chat message; close the tab; reopen. The prior chat messages should reappear in the panel. (Worker in-memory; if worker restarts between sessions, the messages are lost — Phase 8 will add PostgresStore-backed persistence.)

## Success criteria

- Closing the tab sends `navigator.sendBeacon` with `{sessionId, messages}` to `/api/pause`.
- Reopening the tab restores the prior chat messages.
- The `/api/messages?sessionId=...` endpoint returns `{sessionId, messages}` for the active session.
- No regression on the existing pause/resume/suspended list endpoints.
- No regression on the existing approval flow.

## Output

Create `.planning/phases/01-foundation/01-Q-SUMMARY.md` when done.
