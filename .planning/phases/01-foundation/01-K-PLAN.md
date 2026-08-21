---
phase: 1
plan: K
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-13]
depends_on: []
files_modified:
  - lib/redact.ts
  - worker/src/lib/audit.test.ts
autonomous: true
must_haves:
  - "`pnpm test:audit` exits 0; the 5 redaction cases (sk-/pk-/api_=/token=/secret-) all assert `[REDACTED]` is present"
  - "The 'short identifiers stay untouched' test still passes — the `<20 char` payload `short_value_1234567` (19 chars) is preserved"
  - "All 4 redact tests + the classify test (5 total) pass"
requirements:
  - BCK-03
---

# 01-K — Phase 1 Gap Closure (redact regex must trap `=` separator)

Closes G-1-13 (blocker): `lib/redact.ts:4` `SECRET_RE = /(sk|pk|api|key|token|secret)[-_]?[a-z0-9_-]{20,}/gi` only allows `-` or `_` as the separator between prefix keyword and the secret value. Real-world header forms like `api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345` use `=` as the separator — outside the `[-_]?` and `[a-z0-9_-]{20,}` classes — so the regex never matches and the secret leaks into `audit_log.args_json`.

Fix is one char in `lib/redact.ts:4` (add `=` to the separator class). The companion test data `short_value_123456789` (21 chars) in `worker/src/lib/audit.test.ts:27` must be trimmed to `<20` chars once `=` is allowed — otherwise a different assertion fails for the wrong reason. Trim to `short_value_1234567` (19 chars). Two files, two lines.

## Tasks

<task type="auto">
  <id>01-K1-redact-equals-separator</id>
  <read_first>
    - lib/redact.ts (full file — line 4 is the SECRET_RE constant; line 9 calls .replace)
    - worker/src/lib/audit.test.ts (lines 25-29 — the 'short identifiers stay untouched' test that uses 21-char payload; lines 9-23 — the 5-case redaction table including `header api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345`)
  </read_first>
  <action>
    Two surgical edits, two files.

    **Edit 1 — `lib/redact.ts` line 4**: change the separator class from `[-_]?` to `[-_=]?` (add `=`). Final line:

    `const SECRET_RE = /(sk|pk|api|key|token|secret)[-_=]?[a-z0-9_-]{20,}/gi;`

    Update the comment on lines 2-3 to mention `=` alongside `-` and `_`:

    ```
    // M7: scrub secrets before they land in audit_log.args_json or any console output.
    // Pattern is intentionally permissive — covers sk_/pk_/api_/key_/token_/secret_ prefixes
    // (case-insensitive) followed by 20+ alphanumeric/underscore/hyphen/equals chars.
    ```

    Do NOT change the `[a-z0-9_-]{20,}` value class — `=` belongs only in the separator position; allowing `=` inside the value body would still be wrong-shaped but harmless because the value class already requires 20+ chars (long enough that an `=` mid-value is implausible in any real secret).

    **Edit 2 — `worker/src/lib/audit.test.ts` lines 27-28**: trim the test payload from 21 chars to 19 chars so the `<20 chars` invariant still holds. BOTH lines need the update — the `const out = ...` line on 27 AND the `assert.equal(out, ...)` line on 28 — otherwise the verify-step `! grep -qE 'short_value_123456789\b'` would still match against the assertion string.

    ```
    const out = redactString("token=short_value_1234567");
    assert.equal(out, "token=short_value_1234567");
    ```

    (was `short_value_123456789` on BOTH lines)

    The suffix `short_value_1234567` is 19 chars (one fewer than the regex minimum). The assertion `assert.equal(out, "token=short_value_1234567")` still passes because the regex does not match (19 < 20). The companion redaction tests (lines 11-15) use 32-char suffixes (`AbCdEfGhIjKlMnOpQrStUvWxYz012345`) which still match.

    Do NOT change the comment on line 26 — it correctly documents the intent. Do NOT change any other test data.
  </action>
  <files>lib/redact.ts, worker/src/lib/audit.test.ts</files>
  <verify>
    <automated>grep -qE '\[-_=\]\?' lib/redact.ts && grep -qE 'short_value_1234567\b' worker/src/lib/audit.test.ts && ! grep -qE 'short_value_123456789\b' worker/src/lib/audit.test.ts && pnpm test:audit 2>&1 | tail -5 | grep -cE 'pass|tests' | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E '\[-_=\]\?' lib/redact.ts` returns 1 match (separator class includes `=`)
    - `grep 'short_value_1234567' worker/src/lib/audit.test.ts` returns 1+ match (trimmed to 19 chars)
    - `grep 'short_value_123456789' worker/src/lib/audit.test.ts` returns 0 matches (old 21-char payload removed)
    - `pnpm test:audit` exits 0; 5 tests pass (4 redact + 1 classify)
  </acceptance_criteria>
  <done>Redactor regex matches `api_key=...` / `token=...` / `secret=...` header forms; short identifiers (19 chars) still untouched; all 5 audit tests green.</done>
  <reversibility>reversible</reversibility>
  <implements>BCK-03 (audit_log redacts secrets before write)</implements>
  <commit>fix(redact): allow `=` separator — trap api_key=/token=/secret= header forms</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| audit_log.args_json write | `db.insert(auditLog).values({args_json: redact(args), ...})` in `worker/src/lib/audit.ts:44` is the only writer. `redact()` is called on every write. |
| console / test logs | `redact()` and `redactString()` are exported for any log scrubbing path; test data uses real-looking 32-char tokens to assert coverage. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-K-01 | Information Disclosure | audit_log.args_json | high | mitigate | `=` is now in the separator class; `api_key=` / `token=` / `secret=` header forms redact before write. |
| T-1-K-02 | Tampering | Test data | low | accept | Trimming `short_value_123456789` (21) → `short_value_1234567` (19) is intentional: the regex now allows `=` so the previous 21-char payload would match (test would fail for wrong reason). 19 chars stays under the 20-char minimum. |

## Verification

1. `pnpm test:audit` → 5/5 pass (4 redact + 1 classify).
2. Static: `grep '[-_=]?' lib/redact.ts` returns 1 match; `grep 'short_value_1234567' worker/src/lib/audit.test.ts` returns 1 match.
3. `pnpm tsc --noEmit` — no new errors (the redact module is pure JS, audit.test.ts uses node:test built-in).

## Success criteria

- `pnpm test:audit` exits 0; 5 tests pass.
- The `api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345` case in the redact test now asserts `[REDACTED]` is present.
- The `short_value_1234567` (19-char) case still passes (untouched).
- No regression in any other redact case (sk-/pk-/token-/secret- still redacted; case-insensitive still redacted; object-via-JSON.stringify still redacted).

## Output

Create `.planning/phases/01-foundation/01-K-SUMMARY.md` when done.
