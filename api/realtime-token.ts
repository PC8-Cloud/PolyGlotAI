import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiAccess } from "./auth.js";

const OPENAI_API_BASE = "https://api.openai.com/v1";

const LANGUAGE_HINTS: Record<string, string> = {
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
  ru: "Russian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
};

function buildPrompt(languages: unknown): string {
  const names = [...new Set(
    (Array.isArray(languages) ? languages : [])
      .map((code) => LANGUAGE_HINTS[String(code || "").toLowerCase().split("-")[0]])
      .filter(Boolean),
  )];
  const expected = names.length > 0 ? ` Expected languages: ${names.join(" or ")}.` : "";
  return [
    "Transcribe natural face-to-face conversation exactly.",
    "Preserve short words, names, numbers, hesitation markers, and partial conversational phrases.",
    "Do not translate, summarize, add subtitles, or add words that were not spoken.",
    expected,
  ].join(" ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const access = await requireApiAccess(req, res, {
    feature: "conversation",
    quotaKey: "conversation_ms",
    quotaAmount: 1000,
  });
  if (!access) return;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing", status: 500 });
    }

    const model = String(req.body?.model || "gpt-4o-transcribe").trim();
    const response = await fetch(`${OPENAI_API_BASE}/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": access.uid,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "transcription",
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              transcription: {
                model,
                prompt: buildPrompt(req.body?.languages),
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.35,
                prefix_padding_ms: 500,
                silence_duration_ms: 700,
              },
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Realtime token failed",
        status: response.status,
      });
    }

    return res.json({
      value: data?.value,
      expires_at: data?.expires_at,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Realtime token failed", status });
  }
}
