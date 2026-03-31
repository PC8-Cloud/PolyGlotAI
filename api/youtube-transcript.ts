import type { VercelRequest, VercelResponse } from "@vercel/node";

function extractVideoId(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";
  const simpleId = /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : "";
  if (simpleId) return simpleId;
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) {
      return (url.pathname.split("/").filter(Boolean)[0] || "").trim();
    }
    if (url.hostname.includes("youtube.com")) {
      return (url.searchParams.get("v") || "").trim();
    }
  } catch {}
  const match = value.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[?&]|$)/);
  return match?.[1] || "";
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { url } = req.body || {};
    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!watchRes.ok) {
      return res.status(502).json({ error: "Could not load YouTube page" });
    }
    const html = await watchRes.text();

    const playerResponseMatch =
      html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s) ||
      html.match(/"playerResponse":"(\{.+?\})"/s);
    if (!playerResponseMatch) {
      return res.status(404).json({ error: "No player response found" });
    }

    let playerResponse: any = {};
    try {
      if (playerResponseMatch[1].startsWith("{")) {
        playerResponse = JSON.parse(playerResponseMatch[1]);
      } else {
        const unescaped = playerResponseMatch[1]
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        playerResponse = JSON.parse(unescaped);
      }
    } catch {
      return res.status(500).json({ error: "Could not parse YouTube metadata" });
    }

    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      return res.status(404).json({ error: "No captions available for this YouTube video" });
    }

    const track =
      captionTracks.find((t: any) => t.kind !== "asr") ||
      captionTracks[0];
    const baseUrl = String(track?.baseUrl || "");
    if (!baseUrl) {
      return res.status(404).json({ error: "No caption track URL found" });
    }

    const transcriptRes = await fetch(baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!transcriptRes.ok) {
      return res.status(502).json({ error: "Could not fetch YouTube transcript" });
    }
    const xml = await transcriptRes.text();

    const segments: Array<{ start: number; end: number; text: string }> = [];
    const regex = /<text[^>]*start="([^"]+)"[^>]*dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      const start = Number.parseFloat(match[1] || "0");
      const dur = Number.parseFloat(match[2] || "0");
      const text = decodeXmlEntities(match[3] || "");
      if (!text) continue;
      segments.push({
        start,
        end: start + (Number.isFinite(dur) ? dur : 0),
        text,
      });
    }

    if (segments.length === 0) {
      return res.status(404).json({ error: "Transcript is empty or unavailable" });
    }

    const title =
      playerResponse?.videoDetails?.title ||
      `YouTube ${videoId}`;

    return res.json({
      videoId,
      title,
      language: track?.languageCode || "",
      segments,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "YouTube transcript failed", status });
  }
}
