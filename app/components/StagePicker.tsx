"use client";

import { useState } from "react";

// 01-09 / UI-02 / D-14 / D-15 — left sidebar stage picker.
// Foundation is enabled; the 8 SDLC stages are greyed with the tooltip
// `Available in Phase X`. Picking an enabled stage POSTs /api/stage and
// surfaces the friendly `availableInPhase` payload as a toast for others.

const STAGES: Array<{
  id: string;
  label: string;
  enabled: boolean;
  phase: number;
}> = [
  { id: "foundation", label: "Foundation", enabled: true, phase: 1 },
  { id: "prd", label: "PRD", enabled: false, phase: 2 },
  { id: "tickets", label: "Tickets", enabled: false, phase: 3 },
  { id: "design", label: "Design", enabled: false, phase: 4 },
  { id: "code", label: "Code", enabled: false, phase: 4 },
  { id: "test", label: "Test", enabled: false, phase: 5 },
  { id: "review", label: "Review", enabled: false, phase: 5 },
  { id: "deploy", label: "Deploy", enabled: false, phase: 6 },
  { id: "observe", label: "Observe", enabled: false, phase: 7 },
];

export function StagePicker({
  onStageChange,
}: {
  onStageChange?: (id: string, payload: unknown) => void;
}) {
  const [active, setActive] = useState<string>("foundation");
  const [toast, setToast] = useState<string | null>(null);

  const pick = async (id: string, enabled: boolean, phase: number) => {
    if (!enabled) {
      setToast(`Available in Phase ${phase}`);
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const r = await fetch("/api/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: id }),
    });
    const body = await r.json();
    setActive(id);
    onStageChange?.(id, body);
  };

  return (
    <nav
      aria-label="SDLC stages"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 12,
        background: "#161922",
        border: "1px solid #2a2f3a",
        borderRadius: 8,
        minWidth: 160,
      }}
    >
      <span style={{ fontSize: 11, color: "#8b94a7", marginBottom: 4 }}>Stages</span>
      {STAGES.map((s) => {
        const isActive = active === s.id;
        const baseColor = s.enabled ? "#e6e6e6" : "#555a66";
        return (
          <button
            key={s.id}
            title={s.enabled ? s.label : `Available in Phase ${s.phase}`}
            onClick={() => pick(s.id, s.enabled, s.phase)}
            style={{
              textAlign: "left",
              padding: "6px 8px",
              borderRadius: 4,
              border: `1px solid ${isActive ? "#3a4256" : "transparent"}`,
              background: isActive ? "#222a3a" : "transparent",
              color: baseColor,
              fontSize: 12,
              cursor: s.enabled ? "pointer" : "not-allowed",
            }}
          >
            {s.label}
          </button>
        );
      })}
      {toast && (
        <span
          role="status"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "#ffcc00",
            fontFamily: "monospace",
          }}
        >
          {toast}
        </span>
      )}
    </nav>
  );
}
