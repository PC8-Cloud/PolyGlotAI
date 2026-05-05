// Centralized microphone permission helper.
// Permission persistence is browser-managed (per origin). This module
// only exposes "is it granted, prompted-but-not-decided, or denied" and
// a request function that asks once and immediately releases the stream.

export type MicPermissionState = "granted" | "prompt" | "denied" | "unknown";

const PERMISSIONS_API_AVAILABLE =
  typeof navigator !== "undefined" &&
  "permissions" in navigator &&
  typeof (navigator as any).permissions?.query === "function";

export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (!PERMISSIONS_API_AVAILABLE) return "unknown";
  try {
    const status = await (navigator as any).permissions.query({ name: "microphone" });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "unknown";
  }
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
