import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { requireApiAccess } from "./auth";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseModelJson(raw: string): any {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {}
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {}
    }
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const access = await requireApiAccess(req, res, {
    feature: "camera",
    quotaKey: "camera_scans",
    quotaAmount: 1,
  });
  if (!access) return;

  try {
    const { imageBase64, targetLanguage, uiLanguage, model } = req.body;
    if (!imageBase64 || !targetLanguage) return res.status(400).json({ error: "imageBase64 and targetLanguage required" });

    const nameLang = uiLanguage && uiLanguage !== "en" ? uiLanguage : "English";

    const response = await client.chat.completions.create({
      model: model || "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are an OCR + translation assistant for photos (restaurant menus, street signs, notices, labels).
Return ONLY a JSON object with this schema:
{
  "mode": "ocr" | "object",
  "detectedLanguage": "language name in English or empty",
  "extractedText": "all readable text from image in original language, preserving line breaks",
  "translatedText": "full translation of extractedText in ${targetLanguage}",
  "objectName": "short object name in ${nameLang}",
  "translation": "translation of objectName in ${targetLanguage}",
  "pronunciation": "optional pronunciation for translation"
}
Rules:
- If readable text exists, set mode="ocr" and fill extractedText + translatedText.
- Keep numbers, prices, symbols and line breaks intact when possible.
- If text is unclear or absent, set mode="object" and focus on objectName + translation.
- Never add markdown, comments, or extra keys.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this photo. First do OCR of visible text and translate it to ${targetLanguage}. If no readable text, identify the main object. Return strict JSON only.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    const parsed = parseModelJson(response.choices[0].message.content || "{}");
    res.json({
      mode: parsed.mode === "ocr" ? "ocr" : "object",
      detectedLanguage:
        typeof parsed.detectedLanguage === "string" ? parsed.detectedLanguage.trim() : "",
      extractedText:
        typeof parsed.extractedText === "string" ? parsed.extractedText.trim() : "",
      translatedText:
        typeof parsed.translatedText === "string" ? parsed.translatedText.trim() : "",
      objectName:
        typeof parsed.objectName === "string" && parsed.objectName.trim()
          ? parsed.objectName.trim()
          : "Unknown",
      translation:
        typeof parsed.translation === "string" && parsed.translation.trim()
          ? parsed.translation.trim()
          : "...",
      pronunciation:
        typeof parsed.pronunciation === "string" && parsed.pronunciation.trim()
          ? parsed.pronunciation.trim()
          : undefined,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Image analysis failed", status });
  }
}
