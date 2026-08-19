import { z } from "zod";

// 01-09 / UI-02 / D-14 / D-15 — stage picker config.
// Foundation is the only enabled stage in Phase 1; the 8 SDLC stages render greyed.
// Stage list maps to the canonical SDLC phases in PROJECT.md.

export type StageId =
  | "foundation"
  | "prd"
  | "tickets"
  | "design"
  | "code"
  | "test"
  | "review"
  | "deploy"
  | "observe";

export interface StageConfig {
  id: StageId;
  label: string;
  description: string;
  availableInPhase: number;
  enabled: boolean;
}

export const STAGES: StageConfig[] = [
  { id: "foundation", label: "Foundation", description: "Generic chat — no MCP", availableInPhase: 1, enabled: true },
  { id: "prd", label: "PRD", description: "Notion pages + drafts", availableInPhase: 2, enabled: false },
  { id: "tickets", label: "Tickets", description: "Linear sub-issues", availableInPhase: 3, enabled: false },
  { id: "design", label: "Design", description: "v0 UI generation", availableInPhase: 4, enabled: false },
  { id: "code", label: "Code", description: "Sub-agent sandbox + git", availableInPhase: 4, enabled: false },
  { id: "test", label: "Test", description: "Playwright E2E", availableInPhase: 5, enabled: false },
  { id: "review", label: "Review", description: "CodeRabbit + Snyk", availableInPhase: 5, enabled: false },
  { id: "deploy", label: "Deploy", description: "Vercel preview URL", availableInPhase: 6, enabled: false },
  { id: "observe", label: "Observe", description: "Sentry issues", availableInPhase: 7, enabled: false },
];

export const StageIdSchema = z.enum([
  "foundation",
  "prd",
  "tickets",
  "design",
  "code",
  "test",
  "review",
  "deploy",
  "observe",
]);

// Stage-specific instructions. Phase 1 only ships Foundation; the rest are
// placeholders that surface as a friendly payload on /api/stage.
export const STAGE_INSTRUCTIONS: Record<StageId, string> = {
  foundation:
    "You are the SDLC Playground agent. For Phase 1, you have echo (read), " +
    "createNote (write_low), and applyMigrations (write_high). Use createNote when the user asks for a note; " +
    "use applyMigrations when the user asks to migrate. For everything else, answer from chat.",
  prd: "",
  tickets: "",
  design: "",
  code: "",
  test: "",
  review: "",
  deploy: "",
  observe: "",
};

export function getStage(id: StageId): StageConfig | undefined {
  return STAGES.find((s) => s.id === id);
}
