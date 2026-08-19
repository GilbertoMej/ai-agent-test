import type { ReactNode } from "react";

// RSC root. Phase 1 keeps it minimal — banner + page both render directly.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0f1115", color: "#e6e6e6" }}>
        {children}
      </body>
    </html>
  );
}
