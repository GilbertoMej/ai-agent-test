---
status: diagnosed
trigger: "React 19 hydration mismatch error in browser console — two different sess-XXXXX IDs rendered server vs client"
created: 2026-08-19
updated: 2026-08-19
---

## Current Focus
hypothesis: CONFIRMED — `useState(() => …)` initializer branches on `typeof window` and calls `Math.random()` differently on server vs client first render
test: trace
expecting: SSR generates sess-X via the `typeof window === "undefined"` branch; client hydration calls `loadSessionId()` → null on fresh browser → generates a DIFFERENT sess-X via `Math.random()` → mismatch
next_action: return ROOT CAUSE FOUND

## Symptoms
expected: Single consistent session ID rendered on server AND client (no hydration mismatch)
actual: Server renders "sess-k4609nex", client renders "sess-npznub9k" — React 19 hydration error
errors: "Hydration failed because the server rendered text didn't match the client"
reproduction: Load app in fresh browser, inspect console for hydration mismatch
started: After 01-D introduced localStorage-based session key (per 01-UAT.md line 23)

## Eliminated
- hypothesis: nanoid() / crypto.randomUUID() generating the id
  evidence: `grep -nE 'nanoid|Math\.random|crypto\.randomUUID' app/` returns ONLY ChatPanel.tsx lines 65 + 68 — both `Math.random().toString(36)`, no nanoid usage
  timestamp: 2026-08-19
- hypothesis: ID generated in render body (not useState initializer)
  evidence: ID is generated inside `useState(() => …)` lazy initializer — but the initializer itself branches on `typeof window` AND calls `Math.random()` in BOTH branches, so the lazy-init pattern does not save us; both server render and first client render still compute a fresh random id from their own Math.random()
  timestamp: 2026-08-19

## Evidence
- timestamp: 2026-08-19
  checked: app/lib/pause-signal.ts
  found: `loadSessionId()` returns `null` when `typeof window === "undefined"` (server); on a fresh client it returns `null` because localStorage is empty. No ID generation happens here — generation is upstream in ChatPanel.
  implication: localStorage layer is fine. The non-determinism is in ChatPanel.
- timestamp: 2026-08-19
  checked: app/components/ChatPanel.tsx lines 64–71
  found: `const [sessionId] = useState<string>(() => { if (typeof window === "undefined") return \`sess-${Math.random().toString(36).slice(2, 10)}\`; const existing = loadSessionId(); if (existing) return existing; const fresh = \`sess-${Math.random().toString(36).slice(2, 10)}\`; saveSessionId(fresh); return fresh; });`
  implication: SSR branch hits line 65 → generates id #1 from server's Math.random. Client first-render (during hydration) hits line 66–70 → loadSessionId() returns null on fresh tab → generates id #2 from client's Math.random. Two distinct random values → React 19 hydration mismatch on the rendered `<span>Session: {sessionId}</span>` text (line 136).
- timestamp: 2026-08-19
  checked: app/page.tsx
  found: Pure server component that mounts `<ChatPanel />` as a client child. No session logic in the page itself.
  implication: Hydration boundary is at ChatPanel's `useState` initializer — confirms the bug location.
- timestamp: 2026-08-19
  checked: grep over app/ for nanoid/Math.random/crypto.randomUUID
  found: ONLY ChatPanel.tsx:65 and ChatPanel.tsx:68 — both are the same `Math.random().toString(36).slice(2,10)` pattern with `sess-` prefix.
  implication: Single source of non-determinism; no other generators involved.
- timestamp: 2026-08-19
  checked: .planning/phases/01-foundation/01-UAT.md line 23
  found: UAT explicitly reports "React hydration mismatch on session id sess-k4609nex vs sess-npznub9k" — matches symptom exactly.
  implication: Confirms scope (fresh-tab reproduction).

## Resolution
root_cause: ChatPanel's `useState` lazy initializer (ChatPanel.tsx:64-71) generates a fresh session id via `Math.random().toString(36)` in BOTH the SSR branch (typeof window undefined) AND the client first-render branch (loadSessionId() returns null on fresh browser). The server and client each compute an independent random value, so the `<span>Session: {sessionId}</span>` (line 136) renders different text on each side and React 19 aborts hydration. The useState lazy-init pattern does NOT save us here because the initializer itself calls Math.random() — lazy-init only avoids re-running on re-renders, not on the SSR/client render divergence.
fix: Initialize `sessionId` to a stable value on both server and client first render (e.g. empty string `""` or `null`), then load-or-generate the real id inside a `useEffect` and call `setSessionId(...)` to trigger a single re-render. The first paint will render the stable placeholder; the second paint (post-mount) replaces it with the persisted/fresh id — no hydration mismatch because both server and client agree on the initial value.
verification: Load the page in a fresh browser, confirm no React hydration error in the console; the `Session:` label should appear with the stored id immediately after mount. Repeat after a refresh to confirm localStorage persistence still works.
files_changed:
  - app/components/ChatPanel.tsx (split useState initializer into stable-init + useEffect load/generate)
