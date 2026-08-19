---
phase: 1
plan: C
type: execute
wave: 2
depends_on: ["01-A"]
files_modified:
  - worker/src/lib/classify.ts
  - worker/src/lib/classify.test.ts
  - worker/src/tools/create-note.ts
  - worker/src/tools/apply-migrations.ts
  - worker/src/lib/approval.ts
  - app/components/ApprovalCard.tsx
  - app/api/approve/route.ts
  - app/api/decline/route.ts
  - app/components/ChatPanel.tsx
  - worker/src/agents/sdlc.ts
  - app/components/AutoApproveToggle.tsx
  - db/schema/approval-grants.ts
  - drizzle/0001_init.sql
autonomous: false
must_haves:
  - "read tools execute silently (no ApprovalCard)"
  - "write_low shows Approve/Deny inline card with default border"
  - "write_high shows DESTRUCTIVE badge, red border, full args JSON, typed-CONFIRM input"
  - "Typing 'no' in the typed-CONFIRM input + clicking Approve is disabled; tool does not execute"
  - "Typing 'CONFIRM' exactly enables Approve; tool executes; audit row result_status='ok' for applyMigrations"
  - "Approve writes audit_log.approval_decision='user_allow'; decline writes approval_decision='user_deny'"
  - "Auto-approve toggle in header bypasses cards for the session; audit_log.approval_decision='auto'"
  - "Per-card 'Approve all matching for 5 min' writes an approval_grants row; subsequent matching calls skip the card"
  - "requireToolApproval TypeScript return union is boolean | 'always' (verified by tsc)"
---

# 01-C — Human-in-the-Loop

Hardcoded 3-tier tool classifier (D-13), inline approval cards for write_low and write_high, and the auto-approve scope toggle (D-12, HITL-02). All gates go through the same `requireToolApproval` function on `agent.stream()`.

## Tasks

<task>
  <id>01-03-tool-classifier</id>
  <action>Implement the hardcoded classify(toolName): 'read' | 'write_low' | 'write_high' table in worker/src/lib/classify.ts per D-13. Phase 1 working set: echo, rag_query → read; createNote → write_low; applyMigrations → write_high. Cover Phase 2-7 tool patterns (git_commit → write_low; deploy, create_ticket, create_page, open_pr, send_to_sentry, delete_* → write_high) with comments so the registry is ready to extend. Unit-test with vitest. Emits checkpoint:decision before this task runs (D-13 lock-in).</action>
  <files>worker/src/lib/classify.ts, worker/src/lib/classify.test.ts</files>
  <verify>
    <automated>pnpm vitest worker/src/lib/classify.test.ts | grep -q 'all tests passed' && grep -R 'classify(' worker/src/agents/sdlc.ts</automated>
  </verify>
  <done>Classifier table covers the Phase 1 working set + Phase 2-7 placeholders; classifier is called from requireToolApproval in the agent.</done>
  <reversibility>costly</reversibility>
  <checkpoint>decision</checkpoint>
  <implements>HITL-01</implements>
  <commit>feat(hitl): hardcoded tool classification table (D-13)</commit>
</task>

<task>
  <id>01-04a-write-low-gate</id>
  <action>Add the write_low placeholder tool worker/src/tools/create-note.ts (writes only a single row to audit_log; no real effect). Implements (D-09 write_low approval = inline card in chat stream with Approve/Deny buttons, no DESTRUCTIVE badge, no typed-confirm input; D-11 card content tiered — write_low = tool name + 1-line risk reason + buttons). Wire requireToolApproval on agent.stream() using the classifier from 01-03. Surface tool-call-approval chunks in the chat stream. Build the write_low variant of ApprovalCard.tsx (Approve/Deny buttons, no typed-confirm input, no DESTRUCTIVE badge). Wire /api/approve → agent.approveToolCall({ runId, toolCallId }) and /api/decline → agent.declineToolCall({ runId, toolCallId, reason: 'user denied' }). Verify the requireToolApproval TypeScript return union is boolean | 'always' (RESEARCH Open Question #3) by reading the @mastra/core types after install and ensuring the agent code compiles.</action>
  <files>worker/src/tools/create-note.ts, worker/src/lib/approval.ts, app/components/ApprovalCard.tsx, app/api/approve/route.ts, app/api/decline/route.ts, app/components/ChatPanel.tsx</files>
  <verify>
    <automated>pnpm tsc --noEmit && pnpm dev & sleep 5 && curl -fsS -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"create a note"}],"threadId":"hitl-low"}' | head -c 2000 | grep -q 'tool-call-approval' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tool_name='createNote' AND result_status='ok' AND approval_decision='user_allow'" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>Inline ApprovalCard renders for write_low calls; Approve executes the tool; Decline records approval_decision='user_deny'.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_low tier)</implements>
  <commit>feat(hitl): write_low tier — inline card with Approve/Deny</commit>
</task>

<task>
  <id>01-04b-write-high-gate</id>
  <action>Add the write_high placeholder tool worker/src/tools/apply-migrations.ts. The tool is a no-op stub that always tries to run and on execute records { attempted: true, rowsAffected: 0 } — approval is what gates execution, not the tool itself. Implements (D-10 write_high approval = same inline card with text input "type CONFIRM to proceed" + red border + DESTRUCTIVE badge; D-11 write_high card content = tool name + full args JSON expandable + risk reason + typed input). Build the write_high variant of ApprovalCard.tsx: red border, DESTRUCTIVE badge, full args JSON (expandable), typed-confirm input that requires the user to type CONFIRM exactly before the Approve button is enabled. CONFIRM + Approve → execute stub → audit row result_status='ok', tool_name='applyMigrations', approval_decision='user_allow'. Wrong input (anything not equal to CONFIRM) + Approve → button stays disabled, no execution.</action>
  <files>worker/src/tools/apply-migrations.ts, app/components/ApprovalCard.tsx, worker/src/agents/sdlc.ts</files>
  <verify>
    <automated>grep -R 'DESTRUCTIVE' app/components/ApprovalCard.tsx && grep -R "tier === 'write_high'" app/components/ApprovalCard.tsx && grep -R 'rowsAffected: 0' worker/src/tools/apply-migrations.ts && pnpm tsc --noEmit && pnpm dev & sleep 5 && curl -fsS -N -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"apply migrations"}],"threadId":"hitl-high"}' | grep -qE '"toolName"\s*:\s*"applyMigrations"' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tool_name='applyMigrations' AND result_status='ok' AND approval_decision='user_allow'" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>write_high card renders with DESTRUCTIVE badge and typed-CONFIRM gate; CONFIRM enables Approve; audit row confirms successful execution.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-01 (write_high tier)</implements>
  <commit>feat(hitl): write_high tier — typed-CONFIRM gate with DESTRUCTIVE badge</commit>
</task>

<task>
  <id>01-11-auto-approve-toggle</id>
  <action>Add the header Auto-approve all toggle (HITL-02, D-12) and the per-card Approve all matching for 5 min button. The toggle sends approvalMode: 'always' | 'never' | 'tiered' on every /api/chat request; worker reads via RequestContext and requireToolApproval short-circuits. The 5-min batch button writes a row to approval_grants with pattern (tool glob) and expires_at; classifier checks grants before the tier.</action>
  <files>app/components/AutoApproveToggle.tsx, app/components/ApprovalCard.tsx, db/schema/approval-grants.ts, drizzle/0001_init.sql, worker/src/lib/approval.ts</files>
  <verify>
    <automated>pnpm dev & sleep 5 && curl -fsS -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"create a note"}],"threadId":"hitl-auto","approvalMode":"always"}' | grep -qv 'tool-call-approval' && psql $DATABASE_URL -tAc "SELECT count(*) FROM audit_log WHERE tool_name='createNote' AND result_status='ok' AND approval_decision='auto'" | awk '{exit !($1>=1)}' && psql $DATABASE_URL -tAc "SELECT count(*) FROM approval_grants WHERE expires_at > now()" | awk '{exit !($1>=1)}'</automated>
  </verify>
  <done>Toggle on bypasses cards; audit row records approval_decision='auto'; 5-min batch button writes approval_grants row.</done>
  <reversibility>reversible</reversibility>
  <implements>HITL-02</implements>
  <commit>feat(hitl): auto-approve toggle and 5-min batch grant</commit>
</task>

## Decision gate

`checkpoint:decision` BEFORE 01-03 runs — accept the hardcoded classifier table (D-13). The lock-in: adding a UI config layer later means rewiring the registration path. Default: `accept`. Alternative: `change: <table-shape>`.

## Cross-references

- Mastra runtime + audit schema: see 01-A-tracer.md §01-01b / §Canonical schema.
- Storage shape (for approval_grants): see 01-B-persistence-and-rag.md §01-02.
- Action feed surface for tool-call-approval: see 01-D-ui-and-resilience.md §01-10.
