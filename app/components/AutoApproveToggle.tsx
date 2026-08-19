"use client";

import type { ApprovalMode } from "@/worker/src/lib/approval";

// 01-11 — header toggle (HITL-02 / D-12). Three states:
//   tiered  — default; cards appear for write_low / write_high
//   always  — auto-approve everything for the session
//   never   — explicit "always deny" (rare; mostly for debugging)
//
// The parent (ChatPanel) threads the value through /api/chat on every request.

export function AutoApproveToggle({
  value,
  onChange,
}: {
  value: ApprovalMode;
  onChange: (next: ApprovalMode) => void;
}) {
  const opts: Array<{ v: ApprovalMode; label: string }> = [
    { v: "tiered", label: "Tiered" },
    { v: "always", label: "Auto" },
    { v: "never", label: "Deny" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "#8b94a7", marginRight: 6 }}>Approval:</span>
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: "1px solid #3a4256",
            background: value === o.v ? "#3a4256" : "#222a3a",
            color: "#e6e6e6",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
