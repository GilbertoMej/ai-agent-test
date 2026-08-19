import { ChatPanel } from "./components/ChatPanel";
import { HealthBanner } from "./components/HealthBanner";

// RSC shell. Banner probes /api/health immediately; chat panel streams on input.
export default function Page() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <HealthBanner />
      <section style={{ flex: 1, padding: "24px", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>SDLC Playground</h1>
        <ChatPanel />
      </section>
    </main>
  );
}
