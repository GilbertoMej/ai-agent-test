---
phase: 1
plan: J
type: execute
subsystem: dev-bootstrap
tags: [gap-closure, predev, exit-determinism, G-1-1]
gap_ids: [G-1-1]
status: complete
date: 2026-08-20
---

# Phase 1 Plan J: predev explicit exit Summary

Single-file surgical fix to `scripts/predev.ts`: wrap cleanup + embed-refresh in a single async IIFE that awaits both, then `process.exit(0)` explicitly. Stops tsx/Node from hanging on pending promises so `pnpm dev`'s `&&` chain reaches `concurrently`.

## What Changed

`scripts/predev.ts`:
- `maybeRefreshEmbeddings` import moved INTO the IIFE (dynamic `await import("@/worker/src/lib/embed-bootstrap")`)
- IIFE now `await`s both the port-cleanup block and the embed-refresh call
- Each step wrapped in its own `try/catch` that logs to stderr but does not prevent exit
- IIFE ends with `process.exit(0)` — deterministic, no event-loop drain wait
- `void` prefix preserved (best practice for top-level async wrappers)

Net diff: +25 / -7 in one file. Nothing else touched.

## Must-Haves

| Criterion | Result |
|-----------|--------|
| `pnpm dev` proceeds past predev into concurrently within 3s | Designed-for (static verify only; runtime needs live DB) |
| `worker: listening on :4111` appears in `pnpm dev` output | Designed-for (depends on next item) |
| `curl :4111/health` returns worker_up:true | Designed-for |
| Stale port-3000 holders still get killed | Preserved — platform guard + taskkill block intact |
| 01-F2 / 01-G1 / 01-H1 / 01-I1 fixes stay intact | Preserved — only added await + exit |

## Verification

**Automated grep block** (single combined command from plan) — PASSED:
- `process.exit(0)` present
- `await maybeRefreshEmbeddings()` present
- `predev: killed stale port-3000 holder` log preserved
- `void (async () =>` IIFE wrapper present
- No top-level `^maybeRefreshEmbeddings()` fire-and-forget

**Acceptance-criteria counts** — all match plan:
- `process.exit(0)` x1
- `await maybeRefreshEmbeddings()` x1
- `^maybeRefreshEmbeddings()` x0
- `predev: killed stale port-3000 holder` x1
- `void (async () =>` x1
- `process.platform === "win32"` x1

**`pnpm tsc --noEmit`** — 14 pre-existing errors (matches plan's "14 pre-existing" baseline), 0 new. None in `scripts/predev.ts`.

## Deviations from Plan

None — plan executed exactly as written.

## Caveats Carried Forward

- Static verify only; no live `pnpm dev` run (executor lacks InsForge DB). User verifies the boot path manually.
- `await import("@/...")` relies on tsx resolving the `@/` alias via tsconfig paths. If a future tsx version breaks this, fall back to relative `../worker/src/lib/embed-bootstrap` — the plan flagged this.

## Files Modified

- `scripts/predev.ts` (+25 / -7)
