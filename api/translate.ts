import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text, sourceLanguage, targetLanguages, model } = req.body;
    if (!text?.trim() || !targetLanguages?.length) return res.json({});

    const response = await client.chat.completions.create({
      model: model || "gpt-4.1-mini",
      temperature: 0.3,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Translator. Return JSON: {langCode: translation}. Natural, not literal.`,
        },
        {
          role: "user",
          content: `${sourceLanguage} → ${targetLanguages.join(", ")}:\n"${text}"`,
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    res.json(parsed);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Translation failed", status });
  }
}
