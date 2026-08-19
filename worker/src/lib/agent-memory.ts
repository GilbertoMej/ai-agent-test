// D-07 / D-08: memory anchor for agent.stream().
// `resource: 'operator'` is the single-user tenant (D-22 / BCK-02).
// `thread` is the per-tab Mastra threadId stored in `sessions.thread_id` (UI-04).
// ponytail: hardcoded resource; multi-user later, not now.
export function memory(threadId: string) {
  return { thread: threadId, resource: "operator" as const };
}
