// Centralized microphone permission helper.
// Permission persistence is browser-managed (per origin). This module
// only exposes "is it granted, prompted-but-not-decided, or denied" and
// a request function that asks once and immediately releases the stream.

export type MicPermissionState = "granted" | "prompt" | "denied" | "unknown";

const PERMISSIONS_API_AVAILABLE =
  typeof navigator !== "undefined" &&
  "permissions" in navigator &&
  typeof (navigator as any).permissions?.query === "function";

// iOS Safari does not implement navigator.permissions.query for microphone,
// so we persist the granted state ourselves to avoid showing the in-app modal
// on every launch after the user has already allowed the mic.
const LS_MIC_GRANTED = "mic_permission_granted";

function lsGet(key: string): string | null {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch {}
}

export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (PERMISSIONS_API_AVAILABLE) {
    try {
      const status = await (navigator as any).permissions.query({ name: "microphone" });
      if (status.state === "granted") {
        lsSet(LS_MIC_GRANTED, "true");
        return "granted";
      }
      if (status.state === "denied") return "denied";
      return "prompt";
    } catch {}
  }
  // Permissions API unavailable (iOS Safari): fall back to localStorage flag.
  if (lsGet(LS_MIC_GRANTED) === "true") return "granted";
  return "unknown";
}

/** Trigger the native permission prompt. Must be called from a user gesture
 *  on iOS Safari. Resolves to true on grant, false on denial / no support. */
export async function requestMicPermission(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    lsSet(LS_MIC_GRANTED, "true");
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to permission changes (granted ↔ denied) where supported.
 *  Returns an unsubscribe function. */
export async function watchMicPermission(
  cb: (state: MicPermissionState) => void,
): Promise<() => void> {
  if (!PERMISSIONS_API_AVAILABLE) return () => {};
  try {
    const status = await (navigator as any).permissions.query({ name: "microphone" });
    const handler = () => {
      if (status.state === "granted") cb("granted");
      else if (status.state === "denied") cb("denied");
      else cb("prompt");
    };
    status.addEventListener?.("change", handler);
    return () => status.removeEventListener?.("change", handler);
  } catch {
    return () => {};
  }
}
