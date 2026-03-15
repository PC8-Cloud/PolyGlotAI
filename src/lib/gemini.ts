import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!ai) {
    const apiKey = (typeof process !== "undefined" && process.env?.GEMINI_API_KEY) || "";
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY not set. Create a .env file with GEMINI_API_KEY=your_key",
      );
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguages: string[],
): Promise<Record<string, string>> {
  if (!text.trim() || targetLanguages.length === 0) return {};

  const prompt = `Translate the following text from ${sourceLanguage} to the following languages: ${targetLanguages.join(", ")}.

Text to translate:
"${text}"

Return ONLY a JSON object where keys are the target language codes (e.g., 'en', 'es', 'it') and values are the translated text. Do not include markdown formatting like \`\`\`json.`;

  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const jsonStr = response.text?.trim() || "{}";
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Translation error:", error);
    return {};
  }
}

export interface ImageAnalysisResult {
  objectName: string;
  translation: string;
  pronunciation?: string;
}

export async function analyzeImage(
  imageBase64: string,
  targetLanguage: string,
): Promise<ImageAnalysisResult> {
  const prompt = `Look at this image and identify the main object or subject.
Then provide:
1. The name of the object in English
2. The translation in ${targetLanguage}
3. A phonetic pronunciation guide for the translation

Return ONLY a JSON object with these keys:
- "objectName": name in English
- "translation": translation in ${targetLanguage}
- "pronunciation": phonetic pronunciation of the translation

Do not include markdown formatting.`;

  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const jsonStr = response.text?.trim() || "{}";
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Image analysis error:", error);
    return { objectName: "Unknown", translation: "..." };
  }
}
