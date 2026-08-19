"use client";

import { useEffect } from "react";

// 01-13 / UI-04 / D-07 — pause-on-disconnect + session id in localStorage.
// ponytail: sendBeacon is the right transport for beforeunload (fetch gets killed on unload).

const SESSION_KEY = "sdlc.playground.session.v1";

// Use sendBeacon for fire-and-forget on unload; fetch may be cancelled by the browser.
function beaconPause(sessionId: string): void {
  try {
    const blob = new Blob([JSON.stringify({ sessionId })], { type: "application/json" });
    navigator.sendBeacon?.("/api/pause", blob);
  } catch {
    /* ignore */
  }
}

export function loadSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveSessionId(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* ignore */
  }
}

// Hook — call once from a top-level component. Wires beforeunload + visibilitychange.
export function usePauseOnUnload(sessionId: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeUnload = () => beaconPause(sessionId);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") beaconPause(sessionId);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);
}
