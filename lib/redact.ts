// M7: scrub secrets before they land in audit_log.args_json or any console output.
// Pattern is intentionally permissive — covers sk_/pk_/api_/key_/token_/secret_ prefixes
// (case-insensitive) followed by 20+ alphanumeric/underscore/hyphen/equals chars.
const SECRET_RE = /(sk|pk|api|key|token|secret)[-_=]?[a-z0-9_-]{20,}/gi;

export function redact(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.replace(SECRET_RE, "[REDACTED]");
}

export function redactString(s: string): string {
  return s.replace(SECRET_RE, "[REDACTED]");
}
