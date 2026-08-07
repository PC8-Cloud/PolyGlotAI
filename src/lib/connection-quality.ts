import { useEffect, useState } from "react";

// Active connection-quality probe. iOS Safari exposes no network information
// API, so quality is measured for real: a tiny cache-busted fetch, timed.
// ~1 KB per probe — imperceptible even on metered connections.

export type ConnectionQuality = "good" | "weak" | "offline";

const PROBE_URL = "/manifest.webmanifest";
const WEAK_MS = 1500;
const TIMEOUT_MS = 5000;

export async function probeConnectionQuality(): Promise<ConnectionQuality> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    await fetch(`${PROBE_URL}?probe=${start}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    return Date.now() - start > WEAK_MS ? "weak" : "good";
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine ? "weak" : "offline";
  }
}

/** Periodic connection watch for live screens (host/megaphone/conversation).
 *  Re-probes every `intervalMs` and reacts immediately to online/offline. */
export function useConnectionQuality(intervalMs = 15000): ConnectionQuality {
  const [quality, setQuality] = useState<ConnectionQuality>("good");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const q = await probeConnectionQuality();
      if (!cancelled) setQuality(q);
    };
    void check();
    const id = setInterval(check, intervalMs);
    const onOffline = () => setQuality("offline");
    const onOnline = () => { void check(); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [intervalMs]);

  return quality;
}
