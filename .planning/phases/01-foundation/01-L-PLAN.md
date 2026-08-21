---
phase: 1
plan: L
type: execute
wave: 1
gap_closure: true
gap_ids: [G-1-4]
depends_on: []
files_modified:
  - app/components/StagePicker.tsx
autonomous: true
must_haves:
  - "Hovering any greyed SDLC stage button shows the tooltip text inline within 100 ms (no browser-native delay)"
  - "Mousing out clears the tooltip immediately"
  - "Click path still works (existing toast on lines 35-49 + lines 89-101 unchanged)"
  - "Foundation stage remains enabled with no hover tooltip (enabled stages already render with `title= s.label` removed)"
requirements:
  - UI-02
---

# 01-L — Phase 1 Gap Closure (StagePicker tooltip = native title= → immediate React hover)

Closes G-1-4 (minor): `app/components/StagePicker.tsx:72` uses native HTML `title=` on disabled buttons. Browser-native tooltips have a 500–1000 ms delay and can be suppressed by accessibility/extension settings; during quick UAT hover scans the user perceived "no tooltip" and only saw the click-driven React toast at lines 89-101.

Fix replaces the native `title=` attribute with a React state tooltip that appears on `onMouseEnter` and clears on `onMouseLeave`. No new deps (shadcn/ui / Radix are NOT installed per `node_modules/@radix-ui` being absent — CLAUDE.md shadcn section is aspirational). Pure React + existing inline-style pattern. One file.

## Tasks

<task type="auto">
  <id>01-L1-stagepicker-immediate-tooltip</id>
  <read_first>
    - app/components/StagePicker.tsx (full file — STAGES array lines 10-25; tooltip usage at line 72; click toast at lines 89-101)
    - .planning/debug/g-1-4-stage-picker-tooltip.md (root-cause confirmation; ponytail ladder rung 6 — one-line React state swap)
  </read_first>
  <action>
    Single-file edit to `app/components/StagePicker.tsx`.

    **Add hover state** at the top of the `StagePicker` function body (after the existing `useState` lines 32-33, before the `pick` handler at line 35):

    ```
    const [hovered, setHovered] = useState<{ id: string; text: string } | null>(null);
    ```

    The shape holds the id of the hovered stage plus the tooltip text to display — both so we can position the tooltip next to the right row and so the tooltip string is owned by the React render, not by the HTML `title=` machinery.

    **Update the `<button>` map block** at lines 66-88 with three changes:

    1. Remove the `title={...}` attribute (line 72) entirely. Native browser tooltips are gone.
    2. Add `onMouseEnter={() => setHovered({ id: s.id, text: \`Available in Phase ${s.phase}\` })}` to the disabled-button path — only set tooltip text for disabled stages. Enabled stages get `onMouseEnter={() => setHovered({ id: s.id, text: s.label })}` so they also get an immediate hover label, matching the visual richness of the click path. (`title=` is replaced uniformly.)
    3. Add `onMouseLeave={() => setHovered((h) => (h?.id === s.id ? null : h))}` — clears only when the leaving button is the currently hovered one (defensive: prevents clearing a sibling's tooltip if the user moves quickly between rows).
    4. Keep `onClick={() => pick(...)}` exactly as is.

    **Add the tooltip render** just BEFORE the `{toast && (...)}` block at lines 89-101. Render an in-flow inline `<span>` directly below the hovered button (sits inside the `<nav>` element's natural top-to-bottom flow — no `position: absolute` needed; the nav block layout already places it adjacent to the row stack). Pattern (Ponytail: reuse the existing inline-style tokens `#ffcc00` for the toast text + `monospace` font):

    ```
    {hovered && (
      <span
        role="tooltip"
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "#ffcc00",
          fontFamily: "monospace",
        }}
      >
        {hovered.text}
      </span>
    )}
    ```

    This reuses the exact styling of the existing click toast — visual consistency for free.

    Do NOT change the click-path toast (`{toast && (...)}`) — keep it independent. The two paths (hover vs click) now share styling but render conditionally on different state.

    Do NOT add `onFocus`/`onBlur` handlers — keyboard accessibility is out of scope for this minor fix; the existing `cursor: not-allowed` on disabled buttons signals state.

    Do NOT add any new imports. `useState` is already imported at line 2.
  </action>
  <files>app/components/StagePicker.tsx</files>
  <verify>
    <automated>! grep -nE 'title=\{' app/components/StagePicker.tsx | grep -c . | awk '{exit !($1==0)}' && grep -nE 'onMouseEnter' app/components/StagePicker.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'onMouseLeave' app/components/StagePicker.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}' && grep -nE 'role="tooltip"' app/components/StagePicker.tsx | grep -v '^#' | grep -c . | awk '{exit !($1>=1)}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep 'title={' app/components/StagePicker.tsx` returns 0 matches (native title= removed)
    - `grep 'onMouseEnter' app/components/StagePicker.tsx` returns 1+ match (hover-in wired)
    - `grep 'onMouseLeave' app/components/StagePicker.tsx` returns 1+ match (hover-out wired)
    - `grep 'role="tooltip"' app/components/StagePicker.tsx` returns 1 match (accessibility role on tooltip span)
    - `grep 'useState' app/components/StagePicker.tsx` returns 2+ matches (existing toast state + new hover state)
    - `pnpm tsc --noEmit` introduces no new errors in StagePicker.tsx (StagePicker had no pre-existing TS errors)
  </acceptance_criteria>
  <done>Hovering any disabled stage button shows the immediate React-rendered tooltip text inline; hovering out clears it; click path unaffected.</done>
  <reversibility>reversible</reversibility>
  <implements>UI-02 (stage picker surfaces tooltips for disabled stages)</implements>
  <commit>fix(stagepicker): immediate React hover tooltip — drop native title= delay</commit>
</task>

## Threat Model

| Boundary | Description |
|----------|-------------|
| StagePicker hover → state | onMouseEnter/Leave only mutate local React state; no network calls; no side effects. |

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-1-L-01 | Spoofing | Hovered text vs button | low | mitigate | `hovered.id` matches the button's `s.id`; the tooltip span renders in-flow inside the nav block below the hovered row — visual proximity is preserved by the natural top-to-bottom flow of the `<nav>` element. No layout-recalc cost (single span mount/unmount per hover). |
| T-1-L-02 | Information Disclosure | Tooltip text | n/a | accept | Tooltip text is the same string the click toast already shows; no new information surface. |

## Verification

1. Static: `grep` confirms 0 `title={` matches, 1+ `onMouseEnter`/`onMouseLeave`/`role="tooltip"` matches.
2. `pnpm tsc --noEmit` — no new errors.
3. Live (user): `pnpm dev`; load `http://localhost:3000/`; hover cursor over any greyed SDLC stage in the left sidebar. The tooltip text appears within ~100 ms (no browser-native delay) and disappears on mouse leave. Click still drives the existing yellow toast.

## Success criteria

- Native `title=` is removed; React hover tooltip is wired.
- Hover delay is sub-100 ms (vs prior 500-1000 ms browser-native).
- Click path still works (toast still renders).
- No regression in Foundation stage behavior (still selectable, still gets the `cursor: pointer`).

## Output

Create `.planning/phases/01-foundation/01-L-SUMMARY.md` when done.
