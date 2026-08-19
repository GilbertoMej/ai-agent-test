"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

// Polls /api/health every 30s. UI-07 banner — green when worker_up: true.
export function HealthBanner() {
  const [health, setHealth] = useState<{ worker_up: boolean; mcp?: Record<string, string> } | null>(null);

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
        gap: 12,
        padding: "10px 16px",
        background: "#161922",
        borderBottom: "1px solid #2a2f3a",
      }}
    >
      <StatusBadge state={state} label={state === "green" ? "worker up" : state === "yellow" ? "checking..." : "worker offline"} />
      <span style={{ fontSize: 12, color: "#8b94a7" }}>SDLC Playground — Phase 1 Walking Skeleton</span>
    </header>
  );
}
