"use client";

import { ActionFeedEntry, type FeedStatus } from "./ActionFeedEntry";

// 01-10 / UI-03 — action feed renders inline bubbles for tool-call / tool-result /
// tool-error / tool-call-approval parts from the chat stream.
// ponytail: one shape for every part type; per-entry status + result/error rendered inline.

export type FeedPart =
  | {
      type: "text";
      text: string;
    }
  | {
      // AI SDK v5 — tool invocation part, type = `tool-${toolName}`. State drives rendering.
      type: string;
      toolCallId?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      state?: "input-available" | "approval-requested" | "output-available" | "output-error" | "output-denied";
      errorText?: string;
    }
  | {
      type: "tool-approval-request";
      approvalId?: string;
      toolCallId?: string;
    };

export function ActionFeed({ parts }: { parts: FeedPart[] }) {
  if (parts.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", margin: "4px 0" }}>
      {parts.map((p, i) => {
        const tp = p as unknown as {
          type: string;
          toolCallId?: string;
          toolName?: string;
          input?: Record<string, unknown>;
          output?: unknown;
          state?: string;
          errorText?: string;
        };
        const key = `${tp.type}-${tp.toolCallId ?? i}`;
        if (tp.type === "text") return null; // ChatPanel renders text
        if (tp.type === "tool-approval-request") return null; // ChatPanel renders ApprovalCard
        if (tp.type.startsWith("tool-")) {
          // AI SDK v5 puts toolName only in the `type` prefix, not as a separate field.
          const toolName = tp.toolName ?? tp.type.slice("tool-".length);
          if (tp.state === "output-available") {
            return <ActionFeedEntry key={key} status="success" toolName={toolName} result={tp.output} />;
          }
          if (tp.state === "output-error") {
            return <ActionFeedEntry key={key} status="fail" toolName={toolName} error={tp.errorText} />;
          }
          return (
            <ActionFeedEntry
              key={key}
              status={tp.state === "approval-requested" ? "approval" : "running"}
              toolName={toolName}
              args={tp.input}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// Re-export the entry status type so consumers (ChatPanel) can map part->status.
export type { FeedStatus };
