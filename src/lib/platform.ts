export type DistributionChannel = "web_pwa" | "ios_store" | "android_store";

function fromEnv(): DistributionChannel | null {
  const raw = String((import.meta as any)?.env?.VITE_DISTRIBUTION_CHANNEL || "").toLowerCase().trim();
  if (raw === "web_pwa" || raw === "ios_store" || raw === "android_store") {
    return raw;
  }
  return null;
}

function fromRuntime(): DistributionChannel {
  if (typeof window === "undefined") return "web_pwa";

  const win = window as any;
  const isNativeCapacitor = !!win?.Capacitor?.isNativePlatform?.();
  if (isNativeCapacitor) {
    const ua = String(navigator.userAgent || "").toLowerCase();
    if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios_store";
    if (ua.includes("android")) return "android_store";
  }

  return "web_pwa";
}

export function getDistributionChannel(): DistributionChannel {
  return fromEnv() ?? fromRuntime();
}

export function isStoreChannel(channel = getDistributionChannel()): boolean {
  return channel === "ios_store" || channel === "android_store";
}
