import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TTS_LANGUAGE_HINTS: Record<string, string> = {
  it: "Italian",
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text, voice, speed, format, model, langCode } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const normalizedLang = String(langCode || "").toLowerCase().split("-")[0];
    const langName = TTS_LANGUAGE_HINTS[normalizedLang];
    const instructions = langName
      ? `Speak naturally in ${langName} with native pronunciation and conversational intonation.`
      : undefined;

    const response = await client.audio.speech.create({
      model: model || "gpt-4o-mini-tts",
      voice: voice || "nova",
      input: text,
      speed: speed || 1.0,
      response_format: format || "opus",
      ...(instructions ? { instructions } : {}),
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = format === "mp3" ? "audio/mpeg" : "audio/ogg";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "TTS failed", status });
  }
}
