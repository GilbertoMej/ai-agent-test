// node:test (built-in) — same runner as audit.test.ts. Run via `pnpm test:audit`
// (or extend to a test:all script).

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, type ToolClass } from "./classify";

test("classify() — Phase 1 working set", () => {
  assert.equal(classify("echo"), "read");
  assert.equal(classify("rag_query"), "read");
  assert.equal(classify("createNote"), "write_low");
  assert.equal(classify("applyMigrations"), "write_high");
});

test("classify() — read-class prefixes", () => {
  for (const name of ["get_page", "list_issues", "search_pages", "preview_doc"]) {
    assert.equal(classify(name), "read", `${name} should be read`);
  }
});

test("classify() — write-low explicit set", () => {
  for (const name of ["write_file", "git_commit", "run_tests", "sandbox_e2e"]) {
    assert.equal(classify(name), "write_low", `${name} should be write_low`);
  }
});

test("classify() — write-high default for unknown tools", () => {
  for (const name of ["deploy", "create_ticket", "create_page", "open_pr", "send_to_sentry", "delete_repo"]) {
    const cls: ToolClass = classify(name);
    assert.equal(cls, "write_high", `${name} should be write_high`);
  }
});

test("classify() — return type is the literal union (compile-time)", () => {
  // Runtime guard: every result is one of the three literals.
  for (const name of ["echo", "createNote", "applyMigrations", "unknown_tool"]) {
    const cls = classify(name);
    assert.ok(cls === "read" || cls === "write_low" || cls === "write_high");
  }
});
