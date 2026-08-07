import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { probeConnectionQuality, useConnectionQuality } from "../lib/connection-quality";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";

/** One-shot check on app open: if the line looks weak, show a dismissible
 *  notice so the user knows before trusting the voice features. Silent when
 *  the connection is fine. */
export function ConnectionStartupNotice() {
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probeConnectionQuality().then((q) => {
      if (!cancelled && q !== "good") setVisible(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;
  return (
    <div className="mx-4 mt-3 p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl flex items-start gap-3">
      <WifiOff className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-200/90 flex-1">{t("connectionWeakNotice")}</p>
      <button onClick={() => setVisible(false)} className="text-amber-400 hover:text-amber-200 text-xs shrink-0">✕</button>
    </div>
  );
}

/** Slow-pulsing colored frame around the screen while the connection is
 *  degraded: visible in peripheral vision without looking like a crash.
 *  Amber = weak, red = offline. The 2s pulse stays far below any
 *  photosensitivity threshold. Renders nothing when the line is good. */
export function ConnectionFrame() {
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const quality = useConnectionQuality(15000);

  if (quality === "good") return null;
  const isOffline = quality === "offline";
  const rgb = isOffline ? "239,68,68" : "245,158,11";
  return (
    <div className="fixed inset-0 pointer-events-none z-[65]">
      <div
        className="absolute inset-0 animate-pulse"
        style={{ boxShadow: `inset 0 0 0 4px rgba(${rgb},0.9), inset 0 0 28px rgba(${rgb},0.35)` }}
      />
      <div
        className="absolute top-[calc(env(safe-area-inset-top)+0.4rem)] left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold animate-pulse whitespace-nowrap"
        style={{ backgroundColor: `rgba(${rgb},0.92)`, color: "#fff" }}
      >
        {isOffline ? t("connectionOfflineLabel") : t("connectionWeakLabel")}
      </div>
    </div>
  );
}
