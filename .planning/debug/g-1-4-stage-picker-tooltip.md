---
status: diagnosed
trigger: "UAT gap G-1-4 — hovering a greyed SDLC stage shows 'Available in Phase X' tooltip (tooltip doesn't appear on hover; only click shows the message)"
created: 2026-08-20T17:50:00Z
updated: 2026-08-20T17:50:00Z
---

## Current Focus

hypothesis: StagePicker.tsx relies on the native HTML `title=` attribute for the hover hint — this produces a browser-native tooltip with a 500–1000 ms delay that the user perceives as "no tooltip", while the click path drives a clearly-visible React state toast at the bottom of the sidebar.
test: visual comparison of hover vs. click behaviour on a disabled stage button
expecting: hover shows nothing within ~500 ms; click shows the yellow toast inline at line 89–101 of StagePicker.tsx
next_action: return ROOT CAUSE FOUND to caller (no fix to apply)

## Symptoms

expected: 8 disabled SDLC stage entries show 'Available in Phase X' on mouse hover
actual: hover shows nothing; clicking renders the message as a yellow inline toast at the bottom of the sidebar
errors: none
reproduction: open /, hover cursor over any greyed SDLC stage entry in the left sidebar
started: pre-existing — same symptom reported in prior session per UAT test 4 note

## Eliminated

- hypothesis: Click handler is missing
  evidence: StagePicker.tsx:35-49 wires onClick → pick() → setToast for disabled entries; toast renders at line 89-101. Click path is fully functional.
  timestamp: 2026-08-20T17:50:00Z
- hypothesis: `title` attribute is empty/wrong for disabled stages
  evidence: StagePicker.tsx:72 `title={s.enabled ? s.label : \`Available in Phase ${s.phase}\`}` — correct string for disabled stages.
  timestamp: 2026-08-20T17:50:00Z

## Evidence

- timestamp: 2026-08-20T17:50:00Z
  checked: app/components/StagePicker.tsx
  found: Hover hint is implemented via native HTML `title=` attribute on the `<button>` element (line 72). Click hint is implemented via React state (`toast`) that renders an inline `<span role="status">` at the bottom of the nav (lines 35-49, 89-101).
  implication: Two different mechanisms for the same message. The native `title` attribute triggers a browser-default OS tooltip, which (a) has a noticeable delay before appearing (typically 500 ms–1 s), (b) is suppressed by some accessibility/extension settings, and (c) cannot be styled to match the rest of the UI. The click toast is immediately visible because it is rendered as DOM. The user, scanning the sidebar quickly during UAT, never sees the delayed native tooltip and reports it as missing.

## Resolution

root_cause: Hover hint relies on the native HTML `title=` attribute (StagePicker.tsx:72), whose browser-default tooltip has a 500 ms–1 s delay and can be suppressed by browser/OS settings — so it appears "missing" during quick UAT hover checks. The click path, by contrast, drives an immediately-rendered React state toast at line 89–101, which is clearly visible. The bug is the chosen hover mechanism (native `title`), not the message text.
fix: (not applied — find_root_cause_only) Replace the native `title=` hover hint with an explicit React tooltip — either (a) add an `onMouseEnter`/`onMouseLeave` state plus a positioned `<span>` rendered next to/above the hovered button, or (b) wrap with a UI library tooltip primitive (Radix UI / shadcn Tooltip, which the project already uses for primitives per CLAUDE.md). Tooltip should appear on hover with no delay and clear on `mouseleave`.
verification: (not run)
files_changed: []

---

## Suggested Fix Direction (for the gap-closure plan)

Ladder rung (ponytail):
- rung 6 (one line) — replace the `title=` prop on line 72 with a Radix/shadcn Tooltip wrapping the disabled buttons; reuse the existing tooltip primitive the project already pulls in. One file change. No new deps.
- Avoid building a custom CSS tooltip from scratch — Radix is already in the stack per CLAUDE.md shadcn/ui section.

After fix: re-run UAT test 4 — hover any disabled stage, expect immediate visible tooltip matching the click toast text.
