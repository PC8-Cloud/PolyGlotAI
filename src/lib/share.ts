export function openWhatsAppShare(text: string) {
  const payload = text.trim();
  if (!payload || typeof window === "undefined") return;

  const url = `https://wa.me/?text=${encodeURIComponent(payload)}`;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = url;
  }
}
