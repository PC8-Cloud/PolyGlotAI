import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { requireApiAccess } from "./auth";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeParseJson(content: string | null | undefined): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const access = await requireApiAccess(req, res, { feature: "conversation" });
  if (!access) return;

  try {
    const { sourceObj, targetLanguageCode, targetLanguageName, model } = req.body;
    if (!sourceObj || !targetLanguageCode) return res.status(400).json({ error: "sourceObj and targetLanguageCode required" });
    const targetDescriptor = targetLanguageName
      ? `${targetLanguageName} (${targetLanguageCode})`
      : targetLanguageCode;

    const response = await client.chat.completions.create({
      model: model || "gpt-4o",
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional UI translator. Translate only the JSON values from English to ${targetDescriptor}. Keep keys unchanged. Preserve placeholders, punctuation, emojis, and formatting. Return ONLY the translated JSON object.`,
        },
        {
          role: "user",
          content: JSON.stringify(sourceObj),
        },
      ],
    });

    const parsed = safeParseJson(response.choices[0].message.content);
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(sourceObj)) {
      cleaned[key] = typeof parsed[key] === "string" && parsed[key].trim()
        ? String(parsed[key]).trim()
        : String(value);
    }
    res.json(cleaned);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "UI translation failed", status });
  }
}
