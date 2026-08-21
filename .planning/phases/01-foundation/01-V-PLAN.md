---
phase: 1
plan: V
type: execute
wave: 2
gap_closure: true
gap_ids: [G-1-11b]
depends_on: ["01-T"]
files_modified:
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "ChatPanel destructures `setMessages` from useChat and calls it inside the mount-fetch's `.then` handler so the fetched snapshot flows into useChat's internal messages array"
  - "ChatPanel no longer seeds useChat via the `messages` prop on construction (the prop is one-shot — see UseChatHelpers at @ai-sdk/react/dist/index.d.ts:25 for setMessages)"
  - "On mount, if a stored sessionId exists, ChatPanel fetches `/api/messages?sessionId=...` and the .then handler calls `setMessages(body.messages)`; if no stored sessionId exists, the fetch is skipped and setMessages is never called"
  - "After close+reopen of the tab with the same sessionId, prior chat messages reappear in the chat panel"
  - "`pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx"
  - "Live: send 1-2 chat messages, close the tab, reopen within 30s — chat panel renders the prior messages (worker in-memory Map; Phase 8 adds durable persistence)"
requirements:
  - UI-04
---

# 01-V — Phase 1 Gap Closure (useChat loads fetched messages via setMessages after fetch resolves)

Closes G-1-11b (major): ChatPanel constructs `useChat({ messages: initialMessages })` at first render when `initialMessages` is still `[]` (useState default). Mount effect (line 131-148) fires the fetch and calls `setInitialMessages(body.messages)` — but AI SDK v5 useChat treats `messages` as the INITIAL SEED captured at hook construction, not re-read on each render. Subsequent prop changes do not update the internal messages array. Fetched snapshot is silently dropped; panel renders empty after reopen regardless of what `/api/messages` returns.

Fix is option (a) from the diagnosis — use `setMessages` (returned by useChat at @ai-sdk/react/dist/index.d.ts:25) to push the fetched snapshot into the hook's internal state AFTER the fetch resolves. useChat is constructed once at mount with an empty seed; the fetch then calls `setMessages(body.messages)` inside its `.then` handler. The hook re-renders with the populated messages array. This is the smallest-diff fix: no `loaded` gate, no `key={...}` remount trick, no parent-component fetch migration. One destructure addition + one call inside the existing `.then`.

This also fixes the secondary "beacon staleness" bug: by the time the user closes the tab, messagesRef.current is in sync with the rendered messages (the fetch already settled and setMessages updated the hook's array; the ref-mirror effect fired on the new array).

## Tasks

<task type="auto">
  <id>01-V1-gate-usechat-on-loaded-flag</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 75-148 — ChatPanel function body, useState hooks, useChat construction, mount effect)
    - app/api/messages/route.ts (existing Next proxy — fetch returns `{messages: UIMessage[]}` or empty)
    - .planning/debug/g-1-11b-pause-resume-roundtrip.md (full root-cause trace)
  </read_first>
  <action>
    Three coordinated edits in `app/components/ChatPanel.tsx`. All surgical; one file.

    **Edit 1 — Drop the now-unused `initialMessages` state** (remove lines 84-85 + 141).

    The `initialMessages` useState (line 84-85) is no longer needed: we no longer seed useChat via the `messages` prop on first construction. Delete the declaration and the `setInitialMessages(body.messages as UIMessage[])` call inside the mount effect's `.then`.

    Current:

    ```
    // 01-Q — seed useChat with messages fetched from the worker on mount.
    const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
    ```

    Replacement: remove entirely.

    And inside the existing `.then` handler, delete the `if (Array.isArray(body.messages)) { setInitialMessages(body.messages as UIMessage[]); }` block (the replacement in Edit 3 below drops it).

    **Edit 2 — Destructure `setMessages` from useChat** (replace lines 94-100).

    Current:

    ```
    const { messages, sendMessage, status } = useChat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: { approvalMode, sessionId },
      }) as never,
      messages: initialMessages,
    });
    ```

    Replacement:

    ```
    // AI SDK v5 useChat: messages + sendMessage + status + setMessages. body is
    // passed via DefaultChatTransport (a top-level `body` option was removed in v5).
    // 01-U — body must be a function so the captured transport re-reads the React
    // closure on every sendMessage (post-mount setSessionId(fresh) propagates).
    // 01-V — drop `messages: initialMessages` from the seed prop (the prop is only
    // honored at first construction; setting it after mount is silently dropped).
    // Instead, destructure `setMessages` (UseChatHelpers at @ai-sdk/react/dist/index.d.ts:25)
    // and call it inside the mount-fetch's `.then` handler to push the fetched
    // snapshot into the hook's internal state. useChat re-renders with the
    // populated array — no `loaded` gate, no `key={...}` remount, no parent-fetch.
    // ponytail: cast — DefaultChatTransport from `ai` and ChatTransport from
    // `@ai-sdk/react` are structurally identical but nominally distinct.
    const { messages, sendMessage, status, setMessages } = useChat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ approvalMode, sessionId }),
      }) as never,
    });
    ```

    Two changes from 01-U's form: (1) drop the `messages: initialMessages` prop so useChat constructs with an empty seed (matching the useState default before Edit 1); (2) add `setMessages` to the destructure.

    **Edit 3 — Call `setMessages` inside the mount-fetch `.then`** (replace the mount effect at lines 131-148).

    Current:

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

    Replacement:

    ```
    useEffect(() => {
      if (typeof window === "undefined") return;
      const existing = loadSessionId();
      if (existing) {
        setSessionId(existing);
        // Fetch prior messages for this session; push them into useChat's
        // internal messages array via setMessages (the documented API for
        // mutating messages after hook construction — see UseChatHelpers at
        // @ai-sdk/react/dist/index.d.ts:25).
        // 01-V — setMessages is the only way to seed useChat with messages
        // AFTER mount. The `messages` prop is the initial seed captured at
        // hook construction; subsequent prop changes do not update the array.
        // Fetched snapshot is pushed via setMessages(body.messages) below.
        fetch(`/api/messages?sessionId=${encodeURIComponent(existing)}`)
          .then((r) => r.json() as Promise<{ messages?: unknown[] }>)
          .then((body) => {
            if (Array.isArray(body.messages)) {
              setMessages(body.messages as UIMessage[]);
            }
          })
          .catch(() => { /* no prior messages — keep empty */ });
        return;
      }
      const fresh = `sess-${Math.random().toString(36).slice(2, 10)}`; saveSessionId(fresh); setSessionId(fresh);
    }, [setMessages]);
    ```

    Two changes:
    1. Replace `setInitialMessages(body.messages as UIMessage[])` with `setMessages(body.messages as UIMessage[])`. The fetched snapshot now flows into useChat's internal messages array (the array that `messages` returns).
    2. Add `setMessages` to the effect's dependency array (it's stable across renders — useChat returns the same setter reference — but listing it satisfies react-hooks/exhaustive-deps if enabled).

    Do NOT change the `messages` read in the JSX (lines 212-261) — `messages` is now sourced directly from useChat's internal array, which is updated by setMessages.
    Do NOT change `usePauseOnUnload(sessionId, messagesRef.current)` (line 115) — the ref mirror effect (line 101) still fires when messages change, and the beacon closure captures the freshest state.
    Do NOT change `decide()` (lines 156-186) — the approve/decline flow is independent of messages loading.
    Do NOT change `app/api/messages/route.ts` — the Next proxy already returns the worker's stored messages correctly.
  </action>
  <files>app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -nE 'setMessages' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=2)}' && ! grep -nE 'initialMessages' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}' && grep -nE 'body:\s*\(\)\s*=>\s*\(\{.*approvalMode.*sessionId' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'setMessages' app/components/ChatPanel.tsx` returns 2+ matches (destructure + call inside .then)
    - `grep 'initialMessages' app/components/ChatPanel.tsx` returns 0 matches (state retired; useChat's messages prop no longer set)
    - `grep -E 'body:\s*\(\)\s*=>\s*\(\{[^}]*approvalMode[^}]*sessionId' app/components/ChatPanel.tsx` returns 1 match (01-U's function-form body preserved)
    - **Behavioral**: `pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx (pre-existing 7 errors remain out-of-scope per the 01-E carryover list)
    - **Behavioral**: open the app in a browser; send 2 chat messages; close the tab; reopen within 30s — the chat panel renders the 2 prior messages above the input. The previous test (Test 11 in 01-UAT.md) was blocked on the same code path this plan touches; once 01-V lands, Test 11 must pass with a single headless verify or live observation.
    - No edits in app/api/messages/route.ts or any worker file
  </acceptance_criteria>
  <done>ChatPanel's mount-fetch .then calls useChat's setMessages with the fetched snapshot; useChat's internal messages array updates on the next render; the panel renders the prior messages after reopen. The G-1-11b round-trip is closed end-to-end.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04 (session persists across refresh + prior messages reappear after close+reopen)</implements>
  <commit>fix(chat): gate useChat on prior-messages fetch — close+reopen restores chat</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| ChatPanel mount → /api/messages | fetch is read-only; no body sent. Bearer auth on the worker hop is unchanged. |
| /api/messages → worker suspendedRuns | In-memory Map keyed by sessionId; no persistence across worker restart (Phase 8 work). Phase 1 single-user — no cross-session bleed. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-V-01 | Denial of Service | Fetch hangs on worker outage | low | mitigate | `.catch(() => { /* keep empty */ })` leaves the chat with an empty messages array; the panel still renders and the user can send new messages. The pause beacon resumes normally on the next close. |
| T-1-V-02 | Tampering | Cross-session bleed via sessionId | low | accept | sessionId is loaded from localStorage (operator-controlled). Worker suspendedRuns is keyed by sessionId; no global state. |
| T-1-V-03 | Information Disclosure | messages array in chat | low | accept | messages contain operator-typed chat; no secrets. The chat panel already shows them inline. |

## Verification

1. Static: `grep` confirms `setMessages` is destructured from useChat and called inside the mount-fetch's `.then`; `initialMessages` state is retired; 01-U's body function form is preserved.
2. `pnpm tsc --noEmit` — no new errors in ChatPanel.tsx.
3. Live: `pnpm dev`; send 1-2 chat messages; close the tab (the beacon fires POST /api/pause with `{sessionId, messages}`); reopen the tab within 30s. The chat panel renders the prior messages (worker in-memory Map holds them; if worker has restarted between sessions, the panel renders empty but the rest of the session works — Phase 8 adds durable PostgresStore-backed persistence).

## Success criteria

- ChatPanel's mount-fetch calls `setMessages(body.messages)` to seed useChat's internal array with the fetched snapshot.
- useChat's `messages` returns the populated array on the next render.
- After close+reopen of the tab with the same sessionId, prior chat messages reappear in the panel.
- New-session path still works (no fetch, setMessages never called, empty array renders the placeholder).
- Worker-down path doesn't lock the user out (.catch fallback leaves messages empty; chat still usable).
- No regression on the G-1-12 fix at 01-U (body function form is preserved).

## Artifacts this phase produces

- Modified: `app/components/ChatPanel.tsx` (drops `initialMessages` state; adds `setMessages` to useChat destructure; calls `setMessages` inside mount-fetch `.then`)
- Modified symbols: `initialMessages` (removed), `setInitialMessages` (removed), `setMessages` (added to destructure), useChat call site (no `messages` prop), mount effect's `.then` block

## Output

Create `.planning/phases/01-foundation/01-V-SUMMARY.md` when done.
