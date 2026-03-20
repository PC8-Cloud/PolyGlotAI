import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text, voice, speed, format, model } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    const response = await client.audio.speech.create({
      model: model || "gpt-4o-mini-tts",
      voice: voice || "nova",
      input: text,
      speed: speed || 1.0,
      response_format: format || "opus",
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
