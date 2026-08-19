"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

// Polls /api/health every 30s. UI-07 banner. Per-server MCP status surfaced from the probe (01-02b).
type Health = { worker_up: boolean; mcp?: Record<string, string> };
const SERVER_LABEL: Record<string, string> = {
  notion: "Notion",
  linear: "Linear",
  playwright: "Playwright",
  sentry: "Sentry",
};
const STATE_COLOR: Record<string, string> = {
  connected: "#34c759",
  not_loaded: "#8b94a7",
  failed: "#ff453a",
};

export function HealthBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = await r.json();
        if (!stop) setHealth(j);
      } catch {
        if (!stop) setHealth({ worker_up: false });
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const state = health?.worker_up ? "green" : health === null ? "yellow" : "red";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 16px",
        background: "#161922",
        borderBottom: "1px solid #2a2f3a",
        flexWrap: "wrap",
      }}
    >
      <StatusBadge state={state} label={state === "green" ? "worker up" : state === "yellow" ? "checking..." : "worker offline"} />
      <span style={{ fontSize: 12, color: "#8b94a7" }}>SDLC Playground — Phase 1</span>
      {health?.mcp && (
        <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
          {Object.entries(health.mcp).map(([id, status]) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: STATE_COLOR[status] ?? "#8b94a7" }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: STATE_COLOR[status] ?? "#8b94a7",
                  display: "inline-block",
                }}
              />
              {SERVER_LABEL[id] ?? id}: {status}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
