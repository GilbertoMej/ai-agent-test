import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App Router is the default in Next.js 16 — nothing to opt in.
  experimental: {
    // Streaming Server Actions are GA; no flag needed.
  },
};

export default nextConfig;
