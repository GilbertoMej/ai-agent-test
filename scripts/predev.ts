import "dotenv/config";
// scripts/predev.ts — runs once before `next dev` + worker boot.
// 01-06 / D-20: auto-refresh tool_docs embeddings on cold/stale dev boot.
import { maybeRefreshEmbeddings } from "@/worker/src/lib/embed-bootstrap";

maybeRefreshEmbeddings().catch((e) => console.error("predev: embed-bootstrap failed", e));
