import { NextRequest, NextResponse } from "next/server";
import { StageIdSchema, getStage } from "@/worker/src/lib/stage-config";

// 01-09 / UI-02 — /api/stage accepts the stage id and returns either
// {ok:true, instructionsLoaded:true} for Foundation (Phase 1's only enabled
// stage) or a friendly {availableInPhase: N, ok:false} payload for the
// other 8 SDLC stages. The UI shows the latter as a toast (D-15).

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = StageIdSchema.safeParse((body as { stage?: unknown })?.stage);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "unknown stage" }, { status: 400 });
  }
  const stage = getStage(parsed.data);
  if (!stage) {
    return NextResponse.json({ ok: false, error: "stage not registered" }, { status: 404 });
  }
  if (stage.id === "foundation") {
    return NextResponse.json({ ok: true, stage: stage.id, instructionsLoaded: true });
  }
  return NextResponse.json({
    ok: false,
    stage: stage.id,
    availableInPhase: stage.availableInPhase,
    message: `Available in Phase ${stage.availableInPhase}`,
  });
}
