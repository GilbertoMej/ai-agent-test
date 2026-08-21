---
phase: 1
plan: U
type: execute
wave: 2
gap_closure: true
gap_ids: [G-1-12b]
depends_on: ["01-T"]
files_modified:
  - app/components/ChatPanel.tsx
autonomous: true
must_haves:
  - "DefaultChatTransport body is a function form: `body: () => ({ approvalMode, sessionId })` so the React closure is re-read on every sendMessage"
  - "Empty-string sessionId is no longer captured at first render — function form re-reads state every request"
  - "Worker `requestContext.setRaw('sessionId', sessionId ?? 'anon')` receives the real browser sessionId (not '') for chat requests"
  - "`audit_log` rows for chat-driven tool calls carry `session_id` matching the browser's `Session: sess-...` header"
  - "`pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx"
  - "Live: trigger "use echo to say hello" → `SELECT * FROM audit_log WHERE tool_name='echo'` returns a row with the browser sessionId (not 'anon')"
requirements:
  - UI-04
  - BCK-04
---

# 01-U — Phase 1 Gap Closure (DefaultChatTransport body function form — fix sessionId='' in payload)

Closes G-1-12b (blocker): `app/components/ChatPanel.tsx:97` passes `body: { approvalMode, sessionId }` as a STATIC object to `new DefaultChatTransport(...)`. `@ai-sdk/react@2.0.0` useChat captures the Chat (and therefore the transport) ONCE in a useRef on first render (`useRef('chat' in options ? options.chat : new Chat(options))` — line 174-235 of `use-chat.ts`). `http-chat-transport.ts:149` calls `resolve(this.body)` at request time, but `resolve()` on a plain object returns it as-is — it does NOT re-read closure state.

ChatPanel.tsx:81 initializes `sessionId=""` for SSR-stable hydration; line 147 `setSessionId(fresh)` runs in a post-mount `useEffect` — but the captured transport's body closure still holds the FIRST render's `sessionId=""`. Every `sendMessage` POSTs `{sessionId:""}`.

Downstream: worker `setAuditSessionId("")` → `currentSessionId=""` (falsy) → `requestContext.setRaw('sessionId', '' ?? 'anon')` at worker/src/index.ts:112 (?? doesn't trigger on empty string, so empty string survives) → `resolveSessionId()` falls through to `process.env.SESSION_ID ?? 'anon'`. The 01-R module-scope carrier reaches the INSERT path but writes `session_id='anon'` rows. The user's filter by browser sessionId returns 0 rows → "audit_log empty" symptom.

Fix is one line in `app/components/ChatPanel.tsx`: change `body: { approvalMode, sessionId }` to `body: () => ({ approvalMode, sessionId })`. The function form is evaluated at request time via `resolve()` (line 149 of http-chat-transport), re-reading the React closure on every `sendMessage`. After post-mount hydration sets sessionId, the next sendMessage sees the fresh value.

## Tasks

<task type="auto">
  <id>01-U1-defaultchattransport-body-function-form</id>
  <read_first>
    - app/components/ChatPanel.tsx (lines 94-100 — useChat construction with DefaultChatTransport + body; line 81 — useState sessionId=""; lines 131-148 — post-mount setSessionId)
    - node_modules/.pnpm/@ai-sdk+react@2.0.0_react@19.2.0_zod@4.4.3/node_modules/@ai-sdk/react/dist/index.js (lines 174-235 — Chat instance captured ONCE in useRef)
    - node_modules/.pnpm/ai@7.0.68_zod@4.4.3/node_modules/ai/dist/index.js (line 17609 — AbstractChat constructor; line 149 of http-chat-transport — `const resolvedBody = await resolve(this.body)`)
    - worker/src/index.ts (lines 89, 93, 112 — body destructure, setAuditSessionId, requestContext.setRaw)
    - .planning/debug/g-1-12b-audit-log-empty.md (full root-cause trace)
  </read_first>
  <action>
    Single-line edit in `app/components/ChatPanel.tsx:94-100`. Change the `body:` key on the DefaultChatTransport options from a static object to a function form so `resolve()` re-reads the React closure on every request.

    Current lines 94-100:

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
    const { messages, sendMessage, status } = useChat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        // ponytail: body must be a function so `resolve()` re-reads the React
        // closure on every sendMessage. The captured transport on first render
        // would otherwise hold sessionId="" for the lifetime of the Chat instance
        // (useRef captures Chat once — see @ai-sdk/react useChat source).
        // Static object form is captured at construction; only the function form
        // surfaces post-mount setSessionId(fresh) to the worker.
        body: () => ({ approvalMode, sessionId }),
      }) as never,
      messages: initialMessages,
    });
    ```

    ONE change:
    1. Wrap the static object literal in an arrow function `() => ({ ... })`. The shape and field names are unchanged — `resolve()` evaluates the function at request time, producing the same `{ approvalMode, sessionId }` object that the static form would have produced IF sessionId had been correct at first render.

    Do NOT change the cast `as never` (the nominal type mismatch between `ai` and `@ai-sdk/react` DefaultChatTransport is pre-existing and unrelated).
    Do NOT change `messages: initialMessages` (the 01-V plan owns the messages-loading flow; if both plans land in different commits, the messages option is harmless when initialMessages stays `[]`).
    Do NOT change `setSessionId` semantics on lines 131-148 — that still fires after mount and sets the right value; this fix just ensures the transport reads that fresh value on the next sendMessage.
    Do NOT change any other file. The worker side at worker/src/index.ts:89-93 already destructures `sessionId` from body and calls `setAuditSessionId(sessionId)` — that path is correct; only the client's body capture is broken.
  </action>
  <files>app/components/ChatPanel.tsx</files>
  <verify>
    <automated>grep -nE 'body:\s*\(\)\s*=>\s*\(\{.*approvalMode.*sessionId' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && ! grep -nE 'body:\s*\{\s*approvalMode,\s*sessionId\s*\}' app/components/ChatPanel.tsx | grep -c . | awk '{exit !($1==0)}' && grep -nE 'useChat<UIMessage>\(' app/components/ChatPanel.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E 'body:\s*\(\)\s*=>\s*\(\{[^}]*approvalMode[^}]*sessionId' app/components/ChatPanel.tsx` returns 1 match (function form present)
    - `grep -E 'body:\s*\{\s*approvalMode,\s*sessionId\s*\}' app/components/ChatPanel.tsx` returns 0 matches (static object form removed)
    - `grep 'useChat<UIMessage>(' app/components/ChatPanel.tsx` returns 1 match (useChat construction unchanged structurally)
    - `pnpm tsc --noEmit` introduces no new errors in ChatPanel.tsx (pre-existing 7 errors remain unchanged; this plan does NOT touch the type-check surface)
    - No edits in worker/src/index.ts, worker/src/lib/audit.ts, or any worker file (the worker side already destructures sessionId from body correctly)
  </acceptance_criteria>
  <done>DefaultChatTransport body becomes a function form that re-reads React closure state on every sendMessage. Post-mount setSessionId(fresh) propagates to subsequent /api/chat POSTs. Worker setAuditSessionId receives the real browser sessionId; audit_log rows for chat-driven tool calls carry the correct session_id (no longer 'anon'). The G-1-12b blocker is closed.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-04 (session persists across refresh + threads sessionId to audit), BCK-04 (audit_log rows anchored to the right session)</implements>
  <commit>fix(chat): DefaultChatTransport body → function form — propagate post-mount sessionId</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| ChatPanel → /api/chat | `body` is re-evaluated on every sendMessage; the function form has no side effects. approvalMode + sessionId are both React state values; both are operator-readable. |
| /api/chat → worker | Worker already destructures `sessionId` correctly (worker/src/index.ts:89); this plan does NOT touch the worker path. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-U-01 | Information Disclosure | sessionId in body | low | accept | sessionId is the same string the Session: header in the chat already shows; not a secret. Bearer auth on /api/chat is enforced by the Next → worker hop regardless. |
| T-1-U-02 | Tampering | approvalMode from body | low | accept | Body is operator-controlled (the AutoApproveToggle is the only writer); no client-supplied mutation. |

## Verification

1. Static: `grep` confirms function form `body: () => ({ approvalMode, sessionId })`, no static object form remains.
2. `pnpm tsc --noEmit` — no new errors in ChatPanel.tsx (pre-existing 7 errors documented as out-of-scope per the 01-E carryover list).
3. Live: `pnpm dev`; read the browser Session: `sess-xyz` from the header; trigger "use echo to say hello"; in the worker terminal confirm `[chat-debug] in=1 prompt=1 thread=- mode=tiered` (no change); query the database `SELECT session_id, tool_name FROM audit_log WHERE tool_name='echo' ORDER BY ts DESC LIMIT 1` and confirm `session_id` matches `sess-xyz` (not `'anon'`).
4. Optional secondary (per diagnosis): if the user's `SELECT * FROM audit_log` query had been hitting a different DB than the worker writes to (BACKEND_PROVIDER=supabase + SUPABASE_DATABASE_URL pointing elsewhere), this fix would still not produce visible rows. The diagnosis marks this as a "plausible secondary" requiring separate verification — out of scope for this plan.

## Success criteria

- DefaultChatTransport body is a function form.
- Post-mount setSessionId(fresh) reaches the worker's requestContext.setRaw("sessionId", ...).
- audit_log.session_id for chat-driven tool calls equals the browser's sessionId.
- No regression on the requestContext.approvalMode read (G-1-9 fix at 01-O) — both approvalMode and sessionId now propagate correctly via the function-form body.
- No regression on the existing pause/resume (G-1-11 fix at 01-Q).

## Artifacts this phase produces

- Modified: `app/components/ChatPanel.tsx` (DefaultChatTransport body becomes a function form)
- Modified symbols: `useChat(...)` call site — `body` key changes from object literal to arrow function

## Output

Create `.planning/phases/01-foundation/01-U-SUMMARY.md` when done.
