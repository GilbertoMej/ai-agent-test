"use client";

import { useState } from "react";

// 01-04 + 01-11 — inline approval card. One component, three shapes:
//   - write_low  : default border, Approve / Deny, "Approve all matching for 5 min"
//   - write_high : red border, DESTRUCTIVE badge, typed-CONFIRM input
// The parent owns the decision handler (calls /api/approve or /api/decline).

export type ApprovalTier = "write_low" | "write_high";

export interface ApprovalCardProps {
  tier: ApprovalTier;
  toolName: string;
  args: Record<string, unknown>;
  onApprove: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  onApproveAll?: (pattern: string) => void | Promise<void>;
}

export function ApprovalCard({
  tier,
  toolName,
  args,
  onApprove,
  onDecline,
  onApproveAll,
}: ApprovalCardProps) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const isHigh = tier === "write_high";
  const canApprove = !isHigh || confirmText === "CONFIRM";

  const approve = async () => {
    if (!canApprove) return;
    setBusy(true);
    try {
      await onApprove();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await onDecline();
    } finally {
      setBusy(false);
    }
  };

  const approveAll = async () => {
    if (!onApproveAll) return;
    setBusy(true);
    try {
      await onApproveAll(`${toolName}*`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        margin: "8px 0",
        padding: 12,
        borderRadius: 8,
        border: `2px solid ${isHigh ? "#ff5252" : "#3a4256"}`,
        background: isHigh ? "#2a1212" : "#161922",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ color: "#e6e6e6", fontSize: 13 }}>{toolName}</strong>
        <span
          style={{
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 4,
            background: isHigh ? "#ff5252" : "#3a4256",
            color: "#fff",
          }}
        >
          {isHigh ? "DESTRUCTIVE" : "WRITE"}
        </span>
      </div>
      <pre
        style={{
          fontSize: 12,
          color: "#8b94a7",
          background: "#0f1115",
          padding: 8,
          borderRadius: 4,
          margin: "0 0 8px 0",
          overflow: "auto",
          maxHeight: 120,
        }}
      >
        {JSON.stringify(args, null, 2)}
      </pre>
      {isHigh && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: "#ff8a80", display: "block", marginBottom: 4 }}>
            Type CONFIRM to enable
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="CONFIRM"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #ff5252",
              background: "#0f1115",
              color: "#e6e6e6",
              fontFamily: "monospace",
            }}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={approve}
          disabled={!canApprove || busy}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            border: "1px solid #3a6e3a",
            background: canApprove && !busy ? "#3a6e3a" : "#2a2f3a",
            color: "#fff",
            cursor: canApprove && !busy ? "pointer" : "not-allowed",
          }}
        >
          Approve
        </button>
        <button
          onClick={decline}
          disabled={busy}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            border: "1px solid #6e3a3a",
            background: busy ? "#2a2f3a" : "#6e3a3a",
            color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Deny
        </button>
        {onApproveAll && !isHigh && (
          <button
            onClick={approveAll}
            disabled={busy}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #3a4256",
              background: busy ? "#2a2f3a" : "#222a3a",
              color: "#e6e6e6",
              cursor: busy ? "not-allowed" : "pointer",
              marginLeft: "auto",
            }}
            title="Approve all matching tool calls for 5 minutes"
          >
            Approve all matching (5 min)
          </button>
        )}
      </div>
    </div>
  );
}
