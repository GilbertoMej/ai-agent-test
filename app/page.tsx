import { ChatPanel } from "./components/ChatPanel";
import { HealthBanner } from "./components/HealthBanner";
import { StagePicker } from "./components/StagePicker";

// RSC shell. Banner probes /api/health immediately; chat panel streams on input.
// 01-09 / UI-02 / D-14 — StagePicker lives in a left sidebar; chat panel sits to the right.
export default function Page() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <HealthBanner />
      <section
        style={{
          flex: 1,
          padding: "24px",
          maxWidth: 960,
          margin: "0 auto",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <StagePicker />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>SDLC Playground</h1>
          <ChatPanel />
        </div>
      </section>
    </main>
  );
}
