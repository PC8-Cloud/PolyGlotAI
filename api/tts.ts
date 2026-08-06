import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { requireApiAccess, resolveModel } from "./auth.js";

// Let this function stream chunked responses (used by the PCM streaming path,
// which starts sending audio bytes while OpenAI is still generating them).
export const config = { supportsResponseStreaming: true };

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
  const access = await requireApiAccess(req, res, { feature: "conversation" });
  if (!access) return;

  try {
    const { text, voice, speed, format, model, langCode, stream } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const normalizedLang = String(langCode || "").toLowerCase().split("-")[0];
    const langName = TTS_LANGUAGE_HINTS[normalizedLang];

    // gpt-4o-mini-tts ignores the `speed` parameter (known limitation): pacing
    // must be steered through `instructions`. We still pass `speed` for the
    // legacy tts-1/tts-1-hd models, which honor it and ignore `instructions`.
    const rate = Number(speed) || 1.0;
    const pace =
      rate >= 1.35 ? "at a fast pace" :
      rate >= 1.15 ? "at a slightly brisk pace" :
      rate <= 0.8 ? "slowly, articulating every word clearly" :
      rate <= 0.95 ? "at a calm, unhurried pace" :
      "at a natural conversational pace";
    const instructions =
      `Warm, natural, human voice — never robotic or flat. ` +
      (langName ? `Speak in ${langName} with native pronunciation. ` : "") +
      `Use conversational intonation, ${pace}.`;

    const wantsStream = stream === true;
    const resolvedModel = resolveModel("tts", model, "gpt-4o-mini-tts");
    const response = await client.audio.speech.create({
      model: resolvedModel,
      voice: voice || "marin",
      input: text,
      speed: rate,
      // Streaming path uses raw PCM (24kHz 16-bit mono LE): playable chunk by
      // chunk client-side with Web Audio, no container to wait for.
      response_format: wantsStream ? "pcm" : (format || "opus"),
      ...(resolvedModel.startsWith("gpt-") ? { instructions } : {}),
    });

    if (wantsStream) {
      res.status(200);
      res.setHeader("Content-Type", "audio/pcm");
      res.setHeader("Cache-Control", "no-store");
      const body = response.body as unknown as ReadableStream<Uint8Array> | null;
      if (body) {
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.length) res.write(Buffer.from(value));
        }
        res.end();
      } else {
        // Runtime without a readable body: degrade to buffered (still correct).
        res.end(Buffer.from(await response.arrayBuffer()));
      }
      return;
    }

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
