---
phase: 1
plan: K
subsystem: backend/audit-redact
tags: [gap-closure, redact, audit, security, regex, mvp]
gap_ids: [G-1-13]
requires: []
provides: [BCK-03-redact-equals-separator]
affects: [BCK-03, BCK-04]
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - lib/redact.ts
    - worker/src/lib/audit.test.ts
decisions:
  - "Add '=' to the separator class `[-_]?` -> `[-_=]?`; do NOT extend the value class `[a-z0-9_-]{20,}` — '=' only at the boundary"
  - "Trim companion test data `short_value_123456789` (21 chars) -> `short_value_1234567` (19 chars) so the <20-char invariant still holds after '=' is allowed"
metrics:
  duration: 120
  completed: 2026-08-20
  tasks: 1
  files: 2
  commits: 1
status: complete
actuals:
  tokens: 240
  tasks: 1
  commits: 1
---

# Phase 1 Plan K: Redact Regex `=` Separator — SUMMARY

Closes G-1-13 (blocker). One-character fix to `SECRET_RE` in `lib/redact.ts` plus a two-char trim in the companion test data. `pnpm test:audit` now 5/5 green.

## What was built

The audit redactor now traps header-form secrets (`api_key=...`, `token=...`, `secret=...`) before they land in `audit_log.args_json`. Root-cause fix in the shared regex — all callers of `redact()` and `redactString()` route through the same line, so a single boundary widening covers every code path.

## Diff (1 char + 2 chars, 2 files)

```diff
-// followed by 20+ alphanumeric/underscore/hyphen chars.
-const SECRET_RE = /(sk|pk|api|key|token|secret)[-_]?[a-z0-9_-]{20,}/gi;
+// followed by 20+ alphanumeric/underscore/hyphen/equals chars.
+const SECRET_RE = /(sk|pk|api|key|token|secret)[-_=]?[a-z0-9_-]{20,}/gi;
```

```diff
-  const out = redactString("token=short_value_123456789");
-  assert.equal(out, "token=short_value_123456789");
+  const out = redactString("token=short_value_1234567");
+  assert.equal(out, "token=short_value_1234567");
```

## Verification

```
pnpm test:audit
✔ redactString traps sk-/pk-/api-/key-/token-/secret-prefixed strings (3.4822ms)
✔ redact leaves short identifiers alone (regex requires 20+ chars) (0.2658ms)
✔ redact is case-insensitive (0.1224ms)
✔ redact handles objects via JSON.stringify (0.1496ms)
✔ classify() maps tool names to read / write_low / write_high (0.245ms)
ℹ tests 5   pass 5   fail 0   duration_ms 4287.5543
```

Static grep gates (all pass):

- `grep '[-_=]?' lib/redact.ts` — 1 match (separator class includes `=`)
- `grep 'short_value_1234567' worker/src/lib/audit.test.ts` — 1+ match (trimmed to 19 chars)
- `grep 'short_value_123456789' worker/src/lib/audit.test.ts` — 0 matches (old 21-char payload removed)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure-mitigated | `lib/redact.ts` | T-1-K-01 closed: `api_key=` / `token=` / `secret=` header forms now redact before `audit_log.args_json` write |

## Self-Check: PASSED

- File `lib/redact.ts` exists, regex line updated.
- File `worker/src/lib/audit.test.ts` exists, both lines 27-28 trimmed.
- Commit `dec99e8` present in `git log --oneline -3`.
- `pnpm test:audit` exits 0 with 5/5 pass.

---

*Closed G-1-13 — audit_log redaction covers `=` separator.*
