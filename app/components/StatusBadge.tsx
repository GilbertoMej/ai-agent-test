// Tiny traffic-light indicator used by the health banner + (later) the action feed.
// No dependencies; rendered inline. Phase 1 only uses `green` / `yellow` / `red`.
export function StatusBadge({ state, label }: { state: "green" | "yellow" | "red"; label: string }) {
  const color =
    state === "green" ? "#34c759" : state === "yellow" ? "#ffcc00" : "#ff453a";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        background: "#0f1115",
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
