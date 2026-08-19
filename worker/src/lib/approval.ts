import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { classify } from "./classify";

// 01-04 + 01-11 — approval resolver.
// requireToolApproval(toolName, ctx) -> boolean | "always"
//   false  = auto-approve (read tools + grants + approvalMode=always)
//   true   = approve silently (write_low when approvalMode=always; reserved)
//   "always" = pause for inline card
//
// The agent's `requireToolApproval` hook returns the same shape per
// RESEARCH Open Question #3. Worker wires this in agents/sdlc.ts.

export type ApprovalMode = "tiered" | "always" | "never";
export interface ApprovalContext {
  approvalMode?: ApprovalMode;
  grants?: string[]; // tool-name patterns with live approval_grants
}

export function isToolGranted(toolName: string, grants: string[] = []): boolean {
  for (const pat of grants) {
    if (pat === "*" || pat === toolName) return true;
    if (pat.endsWith("*") && toolName.startsWith(pat.slice(0, -1))) return true;
  }
  return false;
}

// DB-side grant loader — filters out expired rows. Cheap; the table is tiny.
export async function loadActiveGrants(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT pattern FROM approval_grants WHERE expires_at > now()
  `)) as unknown as Array<{ pattern: string }>;
  return rows.map((r) => r.pattern);
}

export function resolveApproval(toolName: string, ctx: ApprovalContext = {}): boolean | "always" {
  const cls = classify(toolName);

  // Read tools never gate.
  if (cls === "read") return false;

  // Session-wide auto-approve.
  if (ctx.approvalMode === "always") return false;

  // Per-tool batch grant (5-min "approve all matching").
  if (isToolGranted(toolName, ctx.grants)) return false;

  // Anything else pauses for the card.
  return "always";
}
