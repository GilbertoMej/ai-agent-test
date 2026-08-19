"use client";

import { ActionFeedEntry, type FeedStatus } from "./ActionFeedEntry";

// 01-10 / UI-03 — action feed renders inline bubbles for tool-call / tool-result /
// tool-error / tool-call-approval parts from the chat stream.
// ponytail: one shape for every part type; per-entry status + result/error rendered inline.

export type FeedPart =
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
      durationMs?: number;
    }
  | {
      type: "tool-error";
      toolCallId?: string;
      toolName?: string;
      error?: string;
      transient?: boolean;
      durationMs?: number;
    }
  | {
      type: "tool-call-approval";
      toolCallId?: string;
      toolName?: string;
      tier?: "read" | "write_low" | "write_high";
      args?: Record<string, unknown>;
    };

export function ActionFeed({ parts }: { parts: FeedPart[] }) {
  if (parts.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", margin: "4px 0" }}>
      {parts.map((p, i) => {
        const key = `${p.type}-${p.toolCallId ?? i}`;
        if (p.type === "tool-call") {
          return (
            <ActionFeedEntry
              key={key}
              status="running"
              toolName={p.toolName ?? "unknown"}
              args={p.args}
            />
          );
        }
        if (p.type === "tool-result") {
          return (
            <ActionFeedEntry
              key={key}
              status="success"
              toolName={p.toolName ?? "unknown"}
              result={p.result}
              durationMs={p.durationMs}
            />
          );
        }
        if (p.type === "tool-error") {
          return (
            <ActionFeedEntry
              key={key}
              status="fail"
              toolName={p.toolName ?? "unknown"}
              error={p.error}
              durationMs={p.durationMs}
            />
          );
        }
        return (
          <ActionFeedEntry
            key={key}
            status="approval"
            toolName={p.toolName ?? "unknown"}
            args={p.args}
          />
        );
      })}
    </div>
  );
}

// Re-export the entry status type so consumers (ChatPanel) can map part->status.
export type { FeedStatus };
