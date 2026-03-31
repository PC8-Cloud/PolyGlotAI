function isIOSLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSDevice = /iPad|iPhone|iPod/i.test(ua);
  const iPadOSDesktopUA =
    /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOSDesktopUA;
}

export async function readClipboardText(options?: { manualPrompt?: string }): Promise<string> {
  const promptText = options?.manualPrompt || "Paste text here";

  // iOS Safari/PWA often adds an extra "Paste" confirmation step for readText().
  // Direct manual prompt is more predictable and avoids the double interaction.
  if (isIOSLike() && typeof window !== "undefined") {
    const manual = window.prompt(promptText, "");
    return (manual || "").trim();
  }

  if (navigator.clipboard?.readText) {
    const text = await navigator.clipboard.readText();
    return (text || "").trim();
  }

  if (typeof window !== "undefined") {
    const manual = window.prompt(promptText, "");
    return (manual || "").trim();
  }

  return "";
}
