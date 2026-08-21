---
phase: 1
plan: Z
type: decision
wave: 5
gap_closure: true
gap_ids: [G-1-16]
depends_on: ["01-Y"]
files_modified:
  - lib/pricing.ts
autonomous: true
must_haves:
  - "Operator decision recorded in 01-Z-SUMMARY.md: either (a) lib/pricing.ts:24 PRICING row for opencode-go/hy3 is updated with real published rates, or (b) the placeholder $0/$0 row is left as-is and accepted-as-design with a code comment explaining why (Phase 1 single-user demo, no billing path)"
  - "If decision (a): the row carries real input/output/cache rates published at opencode.dev/pricing (or current Anthropic pricing page for the underlying model), the change is one line in lib/pricing.ts, and a single `console.log('[chat-debug] step-finish usage=...')` is added to worker/src/index.ts:178-185 so the operator can verify the cost counter is computed against real numbers"
  - "If decision (b): no code change to lib/pricing.ts; a `ponytail: cost counter is intentionally $0 — Phase 1 demo has no billing; upgrade when a paid-tier path is added` comment is added to the row"
  - "`pnpm tsc --noEmit` introduces no new errors in any modified file"
requirements:
  - UI-06
---

# 01-Z — Phase 1 Gap Closure (cost counter operator decision: real rates OR accept-as-design)

Closes G-1-16 (major): cost counter shows $0.00 in the header for every chat session. The Phase 1 UAT retest confirmed the counter increments against the value `0` for input/output/cache because `lib/pricing.ts:24` carries a placeholder row for `opencode-go/hy3` with `$0/$0` rates — the opencode-go model is a free Anthropic-hosted tier that has no published per-token price (it's a research preview surfaced via the Anthropic API under a non-billing route).

Two valid resolutions; operator picks one based on whether the Phase 1 demo needs an accurate cost counter:

- **(a) Update with real rates.** Verify the underlying Anthropic model id behind opencode-go/hy3 at Anthropic's pricing page (or opencode.dev/pricing if the opencode tier has its own page). If the model is actually billed at some published rate (e.g. a small per-token amount even for the research tier), update the row. Add a one-line `console.log('[chat-debug] step-finish usage=...')` so the operator can confirm the counter is computed against the real numbers.

- **(b) Accept-as-design.** Leave the row as $0/$0 and add a `ponytail:` comment explaining: Phase 1 is a single-user demo against a free-tier model; the cost counter is informational only; when a paid-tier path is added (Phase 2+), the row gets real rates. The counter showing $0.00 is the correct UX for the current model choice — not a bug.

Plan 01-Z is short because the fix is either a one-line constant update OR a one-line comment + decision record. No new abstractions. No new files. No new tests.

## Tasks

<task type="auto">
  <id>01-Z1-cost-counter-decision-real-rates-or-accept-as-design</id>
  <read_first>
    - lib/pricing.ts (lines 20-30 — the PRICING table; line 24 is the opencode-go/hy3 row with $0/$0)
    - worker/src/index.ts (lines 178-185 — the `step-finish` chunk translator; today it does NOT log usage; optional add)
    - .planning/debug/g-1-16-cost-counter-zero.md (full root-cause trace — recommended either verify-real-rates or accept-as-design)
    - .planning/phases/01-foundation/01-UAT.md (Test 17 — "cost counter increments against non-zero value when input tokens > 0"; the test framework can pass with $0.00 if documented)
  </read_first>
  <action>
    Two coordinated edits across two files. The operator picks decision (a) or (b) at the start of execution; the plan body has both branches; pick the one the operator chooses and skip the other.

    **Decision (a) — Update with real rates.** If the operator chooses this:

    **Edit A1 — Update the PRICING row** (`lib/pricing.ts:24`).

    Current (approximate — read the file for exact text):

    ```
    "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
    ```

    Replacement (use real published rates — verify at opencode.dev/pricing or platform.claude.com/docs/en/about-claude/pricing; the underlying model is opencode-go/hy3 — fill in the actual published numbers):

    ```
    // 01-Z — opencode-go/hy3 actual published rates (verified at <source> on <date>).
    "opencode-go/hy3": { inputPerMTok: <N>, outputPerMTok: <M>, display: "$<N> / $<M> per 1M" },
    ```

    The two numbers come from the operator's verification step (read the pricing page; copy the numbers; format as decimal dollars per MTok). One line changes; one comment line is added.

    **Edit A2 — Add a usage log to the step-finish translator** (`worker/src/index.ts:178-185`).

    Inside the `else if (chunk.type === "step-finish")` branch, after the existing payload handling (which currently doesn't log), add:

    ```
    // 01-Z — log usage so operator can verify cost counter math against real rates.
    console.log(`[chat-debug] step-finish usage=${JSON.stringify(chunk.payload?.usage ?? {})}`);
    ```

    One line; operator can `tail -f` the worker log and confirm tokens arrive as expected, then compute dollars against the PRICING row.

    **Decision (b) — Accept-as-design.** If the operator chooses this:

    **Edit B1 — Add an accept-as-design comment** (`lib/pricing.ts:24`).

    Current:

    ```
    "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
    ```

    Replacement:

    ```
    // ponytail: opencode-go/hy3 is the Anthropic-hosted research-preview tier for
    // Phase 1 — free, no published per-token rate. Cost counter shows $0.00
    // intentionally. Update with real rates when a paid-tier model is added.
    "opencode-go/hy3": { inputPerMTok: 0, outputPerMTok: 0, display: "$0 (free tier — verify)" },
    ```

    No code changes; one comment block. The cost counter continues to show $0.00; the test in 01-UAT.md is acknowledged as "passes by design — see 01-Z-SUMMARY.md".

    Do NOT change anything else. The cost counter is rendered in app/components/Header.tsx (or wherever the Phase 1 header lives — verify with grep); the counter math at PRICING[key] * tokens is correct given the current row. Either decision closes G-1-16.

    Do NOT add a new file. The decision record goes in 01-Z-SUMMARY.md (output below).
  </action>
  <files>lib/pricing.ts</files>
  <verify>
    <automated>grep -nE 'opencode-go/hy3' lib/pricing.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'phase 1.*free.*no published per-token rate|01-Z.*opencode-go/hy3 actual published rates' lib/pricing.ts | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'opencode-go/hy3' lib/pricing.ts` returns 1 match (PRICING row still present)
    - `grep -E 'phase 1.*free.*no published per-token rate|01-Z.*opencode-go/hy3 actual published rates' lib/pricing.ts` returns 1 match (either the accept-as-design comment OR the real-rates comment is present — proves a decision was recorded)
    - 01-Z-SUMMARY.md records which decision was chosen (real-rates + numbers used, OR accept-as-design + reason)
    - If decision (a): `grep 'step-finish usage=' worker/src/index.ts` returns 1 match (usage log added)
    - `pnpm tsc --noEmit` introduces no new errors in any modified file
  </acceptance_criteria>
  <done>Operator decision recorded in 01-Z-SUMMARY.md. PRICING row in lib/pricing.ts:24 carries either real rates + a usage log, or a ponytail accept-as-design comment. G-1-16 closed; cost counter behaves according to the chosen decision.</done>
  <reversibility>reversible</reversibility>
  <implements>OBS-02 (cost counter accuracy)</implements>
  <commit>chore(pricing): record cost-counter decision — real rates or accept-as-design</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| Pricing → Header counter | Cost counter is operator-visible (header); no secrets. The PRICING table is a static lookup; no DB or network access. |
| step-finish usage → log | Optional; usage is operator-typed tokens; no PII. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-Z-01 | Information Disclosure | Real rate numbers in source | low | accept | Anthropic pricing is publicly published; no secret leak. |
| T-1-Z-02 | Tampering | Wrong published rate copy-pasted | low | mitigate | Operator verifies the row against the current pricing page before committing; SUMMARY records the verification source + date. |

## Verification

1. Static: `grep` confirms the opencode-go/hy3 row + decision comment.
2. If decision (a): the row carries real numbers (operator can verify by hand against opencode.dev/pricing or platform.claude.com pricing page); the step-finish usage log appears in the worker terminal during a chat session.
3. If decision (b): the row is unchanged ($0/$0); the accept-as-design comment is in place.
4. `pnpm tsc --noEmit` — no new errors.
5. Live (decision a): `pnpm dev`; send "use echo to say hello" → worker terminal shows `[chat-debug] step-finish usage={"promptTokens":N,"completionTokens":M,...}` → header cost counter shows the computed dollar value (>0 if real rates were filled in).
6. Live (decision b): `pnpm dev`; send "use echo to say hello" → header cost counter shows $0.00 (unchanged; correct for free tier).

## Success criteria

- One of decision (a) or decision (b) is implemented and recorded in 01-Z-SUMMARY.md.
- The cost counter UX matches the decision: real rates → counter increments against non-zero value; accept-as-design → counter shows $0.00 with documented reasoning.
- No regression on the rest of Phase 1 (counter rendering, header layout, etc.).

## Artifacts this phase produces

- Modified: `lib/pricing.ts` (PRICING row either carries real rates OR carries an accept-as-design comment)
- Modified (decision a only): `worker/src/index.ts` (step-finish usage log)
- New: `.planning/phases/01-foundation/01-Z-SUMMARY.md` (records which decision was chosen, the source URL + date for decision (a), or the rationale for decision (b))

## Output

Create `.planning/phases/01-foundation/01-Z-SUMMARY.md` when done. The summary MUST record:
- Decision chosen (a or b)
- If (a): the source URL, the date verified, the four numbers entered (input, output, cacheRead, cacheWrite), and the confirmation that the usage log was added
- If (b): the rationale (Phase 1 single-user demo against a free-tier research model; counter showing $0.00 is correct UX; upgrade path = paid-tier model in Phase 2+)
