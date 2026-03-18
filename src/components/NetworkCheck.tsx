import { useState, useEffect, useCallback, useRef } from "react";
import { WifiOff, X, AlertTriangle } from "lucide-react";
import { useUserStore } from "../lib/store";
import { useTranslation } from "../lib/i18n";

// ─── Minimum requirements ────────────────────────────────────────────────────
const MAX_PING_MS = 2000;
const CHECK_INTERVAL_MS = 30000;

interface NetworkStatus {
  online: boolean;
  pingMs: number | null;
  adequate: boolean;
}

async function measureNetwork(): Promise<NetworkStatus> {
  if (!navigator.onLine) {
    return { online: false, pingMs: null, adequate: false };
  }

  try {
    // Measure ping using navigator.sendBeacon fallback or a simple fetch to own origin
    const pingStart = performance.now();
    // Fetch own page (same-origin, no CORS issues) with HEAD to minimize data
    await fetch(window.location.origin + "/favicon.ico", {
      method: "HEAD",
      cache: "no-store",
    }).catch(() => {
      // If favicon doesn't exist, try the root
      return fetch(window.location.origin + "/", { method: "HEAD", cache: "no-store" });
    });
    const pingMs = Math.round(performance.now() - pingStart);

    const adequate = pingMs <= MAX_PING_MS;
    return { online: true, pingMs, adequate };
  } catch {
    // Fetch failed entirely — likely offline or very broken connection
    return { online: navigator.onLine, pingMs: null, adequate: false };
  }
}

export default function NetworkCheck() {
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const [status, setStatus] = useState<NetworkStatus>({ online: true, pingMs: null, adequate: true });
  const [dismissed, setDismissed] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAdequate = useRef(true);

  const runCheck = useCallback(async () => {
    const result = await measureNetwork();
    setStatus(result);

    if (!result.online) {
      setShowOffline(true);
      setDismissed(false);
    } else if (showOffline) {
      setShowOffline(false);
    }

    // Only re-show slow banner if connection transitioned from adequate → inadequate
    if (!result.adequate && result.online && lastAdequate.current) {
      setDismissed(false);
    }
    lastAdequate.current = result.adequate;
  }, [showOffline]);

  useEffect(() => {
    const initTimer = setTimeout(runCheck, 3000);
    intervalRef.current = setInterval(runCheck, CHECK_INTERVAL_MS);

    const handleOnline = () => runCheck();
    const handleOffline = () => {
      setStatus({ online: false, pingMs: null, adequate: false });
      setShowOffline(true);
      setDismissed(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearTimeout(initTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [runCheck]);

  // ─── Offline banner (red, not dismissible) ────────────────────────────────
  if (!status.online || showOffline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
        <div className="w-full max-w-[430px] pointer-events-auto">
          <div className="mx-3 mt-3 rounded-2xl bg-red-900/95 backdrop-blur-md border border-red-500/40 p-4 shadow-2xl animate-slide-down">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <WifiOff className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">
                  {(t as any).networkOfflineTitle || "No internet connection"}
                </p>
                <p className="text-red-200/80 text-xs mt-1 leading-relaxed">
                  {(t as any).networkOfflineDesc || "PolyGlot AI requires an internet connection to translate, transcribe and synthesize speech. Please check your Wi-Fi or mobile data."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Slow connection banner (amber, dismissible) ──────────────────────────
  if (!status.adequate && !dismissed) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
        <div className="w-full max-w-[430px] pointer-events-auto">
          <div className="mx-3 mt-3 rounded-2xl bg-amber-900/95 backdrop-blur-md border border-amber-500/30 p-4 shadow-2xl animate-slide-down">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">
                  {(t as any).networkSlowTitle || "Slow internet connection"}
                </p>
                <p className="text-amber-200/80 text-xs mt-1 leading-relaxed">
                  {(t as any).networkSlowDesc || "Your internet connection does not meet the minimum requirements for PolyGlot AI to work properly. Translations and voice features may be slow or unavailable. This is not an app issue — please try moving to an area with better signal or switching to Wi-Fi."}
                </p>
                {status.pingMs !== null && (
                  <p className="mt-2 text-[10px] text-amber-300/60 font-mono">
                    Ping: {status.pingMs}ms {status.pingMs > MAX_PING_MS ? "⚠️" : "✓"}
                  </p>
                )}
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition"
              >
                <X className="w-4 h-4 text-white/70" />
              </button>
            </div>
            <p className="text-amber-200/50 text-[10px] mt-3 text-center">
              {(t as any).networkMinRequirements || "Minimum: 1 Mbps download, ping < 2s"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
