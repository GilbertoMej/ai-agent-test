// D-13 — hardcoded tool classifier. Source of truth for the 3-tier HITL flow.
// Phase 1 working set + Phase 2-7 placeholders. Adding tools = extend the table.
//
// Ponytail: hardcoded table, no config layer. Per-tool approval gates live in
// worker/src/lib/approval.ts; this file is purely the read/write_low/write_high
// classification (RESEARCH Open Question #3 — boolean | 'always' return union).

export type ToolClass = "read" | "write_low" | "write_high";

export function classify(toolName: string): ToolClass {
  // Phase 1 working set
  if (toolName === "echo" || toolName === "rag_query") return "read";
  if (toolName === "createNote") return "write_low";
  if (toolName === "applyMigrations") return "write_high";

  // Read-class patterns (Phase 2-7 tools — extend as MCPs ship)
  if (
    toolName.startsWith("get_") ||
    toolName.startsWith("list_") ||
    toolName.startsWith("search_") ||
    toolName.startsWith("preview_")
  )
    return "read";

  // Write-low (Phase 2-7)
  if (
    toolName === "write_file" ||
    toolName === "git_commit" ||
    toolName === "run_tests" ||
    toolName === "sandbox_e2e"
  )
    return "write_low";

  // Write-high (Phase 2-7) — anything not explicitly read/write_low lands here.
  // Includes: deploy, create_ticket, create_page, open_pr, send_to_sentry, delete_*.
  return "write_high";
}
