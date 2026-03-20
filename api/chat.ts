import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, model } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });

    const response = await client.chat.completions.create({
      model: model || "gpt-4.1-mini",
      temperature: 0.7,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages,
    });

    const content = response.choices[0].message.content || "{}";
    res.json(JSON.parse(content));
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Chat failed", status });
  }
}
