import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sourceObj, targetLanguage, model } = req.body;
    if (!sourceObj || !targetLanguage) return res.status(400).json({ error: "sourceObj and targetLanguage required" });

    const response = await client.chat.completions.create({
      model: model || "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate JSON values from English to ${targetLanguage}. Keep keys unchanged. Return ONLY the translated JSON object.`,
        },
        {
          role: "user",
          content: JSON.stringify(sourceObj),
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    res.json(parsed);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "UI translation failed", status });
  }
}
