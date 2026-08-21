import { NextRequest, NextResponse } from "next/server";
import { ingestMarkdown } from "@/lib/ingest";

// UI doc upload → tool_docs. Accepts multipart/form-data:
//   file:    .md/.markdown/.txt (required)
//   tool:    optional label (defaults to filename stem)
//   version: optional (defaults to "local")
// Embedding needs OPENROUTER_API_KEY; rows insert even if embedding fails
// (surfaced via the `embedded` count in the response).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = /\.(md|markdown|txt|text)$/i;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof (file as { text?: unknown }).text !== "function") {
      return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
    }
    const f = file as File;
    if (!ALLOWED.test(f.name)) {
      return NextResponse.json({ ok: false, error: "only .md/.markdown/.txt" }, { status: 415 });
    }
    const md = await f.text();
    if (!md.trim()) {
      return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });
    }
    const tool =
      (form.get("tool") as string | null)?.trim() || f.name.replace(/\.[^.]+$/i, "");
    const version = (form.get("version") as string | null)?.trim() || "local";
    const res = await ingestMarkdown(md, { tool, version, source: f.name });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
