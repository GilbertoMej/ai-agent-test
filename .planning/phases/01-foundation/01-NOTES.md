# Phase 1 — Runtime notes

Captured during execution. Read alongside `01-A-PLAN.md` (canonical audit_log
schema), `01-B-PLAN.md` (storage/lifecycle/RAG), `01-C-PLAN.md` (HITL), and
`01-D-PLAN.md` (UI + resilience).

## Backend provider

InsForge (project `AI Agent Test`, app key `xgi8meh6`, region `us-west`):

- API host: `https://xgi8meh6.us-west.insforge.app`
- Project ID: `7133938c-e924-4405-b9ff-12bbf8134f0d`
- Project JSON (key/URL only — keep out of git): `.insforge/project.json`
- Postgres reachable directly via the SDK (`createClient`) or via psql with
  the DATABASE_URL pulled from the project JSON.

## AI gateway

InsForge routes OpenAI-style calls through OpenRouter. The linked project ships
with `OPENROUTER_API_KEY` written to `.env.local` by `npx @insforge/cli ai setup`.
- Chat default: `openai/gpt-4o-mini` (already used, 40 req / 44 115 tok / $0.01).
- Embedding default: `openai/text-embedding-3-small` (already used, 17 req).

## Embedding probe (resolves 01-B 01-06 `checkpoint:human-verify`)

`POST https://openrouter.ai/api/v1/embeddings` with bearer `OPENROUTER_API_KEY`:

```json
{
  "model": "openai/text-embedding-3-small",
  "input": "hello"
}
```

Probe response (2026-08-19, after `npx @insforge/cli login` + `link`):

```json
{
  "model": "text-embedding-3-small",
  "dim": 1536,
  "usage": {
    "prompt_tokens": 1,
    "total_tokens": 1,
    "cost": 2e-8
  }
}
```

- **Embedding model:** `openai/text-embedding-3-small`
- **Embedding dimensions:** **1536**

The canonical 11-column `audit_log` and the `tool_docs.embedding vector(1536)`
column locked by `01-A` already match — no schema patch required. The
provisional `[ASSUMED]` marker on `01-B`'s `checkpoint:decision` is now
resolved.

## Chat model (provisional, lock-in at 01-01b)

- `openai/gpt-4o-mini` — InsForge AI gateway default, $0.15/$0.60 per 1M tok.
  Already used by the project (40 req / 44 115 tok / $0.01).
- Mastra worker uses `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` per
  `01-A`'s `01-01b-runtime` decision (D-02). Adjust the model id in
  `worker/src/agents/sdlc.ts` if the gateway rejects the slug.

## Env file (`/c/Users/Pichu/Documents/.../ai-agent-test/.env.local`)

```
INSFORGE_URL=https://xgi8meh6.us-west.insforge.app
INSFORGE_ANON_KEY=...
INSFORGE_API_KEY=ik_b61f6008682d0a9ce8513352930ffa9d
NEXT_PUBLIC_INSFORGE_URL=https://xgi8meh6.us-west.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=...
OPENROUTER_API_KEY=sk-or-v1-861...4fc
DATABASE_URL=postgres://postgres:<password>@<host>:<port>/postgres
WORKER_SHARED_SECRET=<random>
```

Keep `.env.local` out of git (already in `.gitignore`).