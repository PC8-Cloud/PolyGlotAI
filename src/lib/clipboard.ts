export async function readClipboardText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    const text = await navigator.clipboard.readText();
    return (text || "").trim();
  }
  throw new Error("Clipboard API unavailable");
}
