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

function langName(code: unknown): string {
  const c = String(code || "").toLowerCase().split("-")[0];
  return LANGUAGE_HINTS[c] || (c ? c.toUpperCase() : "");
}

function buildTranscriptionPrompt(languages: unknown): string {
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

function buildTranslatorInstructions(yourLang: unknown, theirLang: unknown): string {
  const A = langName(yourLang) || "language A";
  const B = langName(theirLang) || "language B";
  // Session-level fallback. The client overrides per-response with explicit
  // sourceLang→targetLang instructions, so this only kicks in if a response
  // is ever generated without override.
  return [
    `You are a silent translation engine between ${A} and ${B}.`,
    `You only translate verbatim. You never greet, acknowledge, apologise, summarise, answer questions, or comment.`,
    `If the request does not specify a target language, do nothing.`,
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

    const mode = String(req.body?.mode || "transcription").trim();
    const languages = Array.isArray(req.body?.languages) ? req.body.languages : [];

    let sessionBody: Record<string, unknown>;

    if (mode === "translator") {
      const yourLang = languages[0];
      const theirLang = languages[1];
      const voice = String(req.body?.voice || "marin").trim();
      const transcribeModel = String(req.body?.transcribeModel || "gpt-4o-transcribe").trim();
      const model = String(req.body?.model || "gpt-realtime").trim();

      sessionBody = {
        type: "realtime",
        model,
        output_modalities: ["audio"],
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: {
              model: transcribeModel,
              prompt: buildTranscriptionPrompt(languages),
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              // Capture 700ms of audio before VAD trips so the attack of the
              // first word is never lost when listening resumes.
              prefix_padding_ms: 700,
              silence_duration_ms: 800,
              // The client validates the transcript first, then issues an
              // explicit response.create with source→target instructions.
              // This prevents the model from inventing "Sorry / Mi scusi"
              // when audio is silent, noisy, or ambiguous.
              create_response: false,
              interrupt_response: true,
            },
          },
          output: {
            voice,
            format: { type: "audio/pcm", rate: 24000 },
          },
        },
        instructions: buildTranslatorInstructions(yourLang, theirLang),
      };
    } else {
      const model = String(req.body?.model || "gpt-4o-transcribe").trim();
      sessionBody = {
        type: "transcription",
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: {
              model,
              prompt: buildTranscriptionPrompt(languages),
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.35,
              prefix_padding_ms: 500,
              silence_duration_ms: 500,
            },
          },
        },
      };
    }

    const response = await fetch(`${OPENAI_API_BASE}/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": access.uid,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: sessionBody,
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
