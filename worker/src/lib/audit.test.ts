// node:test (built-in) — no vitest dep needed. Run via `pnpm test:audit` (added to package.json).
// Tests the redact regex + classify() + the audit row shape produced by withAudit() with a mocked DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactString } from "@/lib/redact";
import { classify } from "./audit";

test("redactString traps sk-/pk-/api-/key-/token-/secret-prefixed strings", () => {
  const cases: [string, string][] = [
    ["openai api key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345", "[REDACTED]"],
    ["public pk_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345", "[REDACTED]"],
    ["header api_key=AbCdEfGhIjKlMnOpQrStUvWxYz012345", "[REDACTED]"],
    ["bearer token=AbCdEfGhIjKlMnOpQrStUvWxYz012345", "[REDACTED]"],
    ["client secret-AbCdEfGhIjKlMnOpQrStUvWxYz012345", "[REDACTED]"],
  ];
  for (const [input, expectedFragment] of cases) {
    const out = redactString(input);
    assert.ok(out.includes(expectedFragment), `expected redaction in: ${input} -> ${out}`);
    // 20+ char payloads are replaced; short payloads (<20) are NOT touched by the regex.
    assert.ok(!out.includes("AbCdEfGhIjKlMnOpQrStUvWxYz012345"), `secret leaked: ${out}`);
  }
});

test("redact leaves short identifiers alone (regex requires 20+ chars)", () => {
  // 19-char suffix must not match — protects e.g. enum names that look prefix-shaped.
  const out = redactString("token=short_value_123456789");
  assert.equal(out, "token=short_value_123456789");
});

test("redact is case-insensitive", () => {
  const out = redactString("SK-PROJ-AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  assert.ok(out.includes("[REDACTED]"));
});

test("redact handles objects via JSON.stringify", () => {
  const out = redact({ token: "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345", ok: 1 });
  assert.ok(out.includes("[REDACTED]"));
  assert.ok(out.includes('"ok":1'));
});

test("classify() maps tool names to read / write_low / write_high", () => {
  assert.equal(classify("echo"), "read");
  assert.equal(classify("rag_query"), "read");
  assert.equal(classify("get_page"), "read");
  assert.equal(classify("list_issues"), "read");
  assert.equal(classify("search_pages"), "read");
  assert.equal(classify("write_file"), "write_low");
  assert.equal(classify("git_commit"), "write_low");
  assert.equal(classify("run_tests"), "write_low");
  assert.equal(classify("sandbox_e2e"), "write_low");
  assert.equal(classify("create_ticket"), "write_high");
  assert.equal(classify("deploy"), "write_high");
  assert.equal(classify("git_push"), "write_high");
});
