"use client";

import { useState } from "react";

// 01-10 / UI-03 / D-16 / D-17 — single action feed entry.
// Per-entry fields: tool name, truncated args (expandable), status icon, duration (ms), result snippet.

export type FeedStatus = "running" | "success" | "fail" | "approval";

export interface ActionFeedEntryProps {
  status: FeedStatus;
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

const STATUS_COLOR: Record<FeedStatus, string> = {
  running: "#ffcc00",
  success: "#34c759",
  fail: "#ff453a",
  approval: "#5ac8fa",
};

const STATUS_ICON: Record<FeedStatus, string> = {
  running: "…",
  success: "✓",
  fail: "✗",
  approval: "?",
};

export function ActionFeedEntry({
  status,
  toolName,
  args,
  result,
  error,
  durationMs,
}: ActionFeedEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[status];
  const argsText = args ? JSON.stringify(args) : "";
  const truncated = argsText.length > 80 ? argsText.slice(0, 80) + "…" : argsText;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "4px 8px",
        borderRadius: 4,
        background: status === "fail" ? "#2a1212" : "#0f1115",
        border: `1px solid ${color}33`,
        fontSize: 12,
        margin: "2px 0",
      }}
    >
      <span style={{ color, fontFamily: "monospace", minWidth: 12 }}>{STATUS_ICON[status]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <strong style={{ color: "#e6e6e6" }}>{toolName}</strong>
          {durationMs != null && (
            <span style={{ color: "#8b94a7", fontSize: 11 }}>{durationMs}ms</span>
          )}
        </div>
        {truncated && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              background: "none",
              border: "none",
              color: "#8b94a7",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            {expanded ? argsText : truncated}
          </button>
        )}
        {status === "fail" && error && (
          <div style={{ color: "#ff8a80", fontSize: 11, marginTop: 2 }}>{error}</div>
        )}
        {status === "success" && result != null && (
          <div style={{ color: "#8b94a7", fontSize: 11, marginTop: 2 }}>
            {typeof result === "string" ? result : JSON.stringify(result).slice(0, 120)}
          </div>
        )}
      </div>
    </div>
  );
}
