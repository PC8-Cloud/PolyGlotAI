import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, targetLanguage, uiLanguage, model } = req.body;
    if (!imageBase64 || !targetLanguage) return res.status(400).json({ error: "imageBase64 and targetLanguage required" });

    const nameLang = uiLanguage && uiLanguage !== "en" ? uiLanguage : "English";

    const response = await client.chat.completions.create({
      model: model || "gpt-4.1-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You identify objects in images and provide translations. Return a JSON object with: "objectName" (name of the object in ${nameLang}), "translation" (in the target language), "pronunciation" (phonetic guide for the translation).`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `What is the main object in this image? Give its name in ${nameLang} and translate it to ${targetLanguage}.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    res.json(parsed);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Image analysis failed", status });
  }
}
