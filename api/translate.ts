import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT_LANGUAGE_OVERRIDES: Record<string, string> = {
  zh: "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  pt: "Portuguese",
  tl: "Tagalog",
};

const englishLanguageNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

function getPromptLanguageName(code: string, fallback?: string): string {
  const normalized = String(code || "").trim();
  if (!normalized) return fallback || "Unknown";
  if (PROMPT_LANGUAGE_OVERRIDES[normalized]) return PROMPT_LANGUAGE_OVERRIDES[normalized];
  return (
    fallback ||
    englishLanguageNames?.of(normalized) ||
    englishLanguageNames?.of(normalized.split("-")[0]) ||
    normalized.toUpperCase()
  );
}

function normalizeTargets(
  targetLanguages: unknown,
  targetLanguageNames?: Record<string, string>,
): Array<{ code: string; name: string }> {
  const uniqueCodes = [...new Set(Array.isArray(targetLanguages) ? targetLanguages.map((v) => String(v).trim()).filter(Boolean) : [])];
  return uniqueCodes.map((code) => ({
    code,
    name: getPromptLanguageName(code, targetLanguageNames?.[code]),
  }));
}

function safeParseJson(content: string | null | undefined): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeTranslation(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getModeInstructions(mode: string): string[] {
  switch (mode) {
    case "live":
      return [
        "Optimize for short spoken utterances and conversational immediacy.",
        "Prefer natural spoken phrasing over formal written style.",
        "If the sentence is slightly fragmented, still translate it coherently without padding.",
      ];
    case "phrases":
      return [
        "These are standalone travel phrases.",
        "Prefer the most useful and idiomatic wording a traveler should actually say.",
        "Avoid overly literal translations.",
      ];
    case "tourism":
      return [
        "The domain is travel, hospitality, transport, shopping, and emergency assistance.",
        "Prefer domain-appropriate wording a traveler would hear or say in real life.",
      ];
    case "room":
      return [
        "This text is for multilingual live-room broadcasting.",
        "Optimize for readability and fast comprehension on screen.",
      ];
    case "question":
      return [
        "This text is a guest question addressed to a host or speaker.",
        "Preserve the interrogative tone and intent clearly.",
      ];
    default:
      return [];
  }
}

function buildGlossaryHints(text: string, mode: string, incomingHints: unknown): string[] {
  const hints = Array.isArray(incomingHints)
    ? incomingHints.map((hint) => String(hint).trim()).filter(Boolean)
    : [];
  const lower = text.toLowerCase();

  const tourismHints = [
    { match: /\bbill\b/, hint: "If the context is restaurant/service, translate 'bill' as restaurant check, not banknote or proposed law." },
    { match: /\broom\b/, hint: "If the context is hotel, translate 'room' as hotel room, not generic room/space." },
    { match: /\bgate\b/, hint: "If the context is airport, translate 'gate' as boarding gate." },
    { match: /\bcheck-?out\b/, hint: "Translate 'checkout/check-out' using the hotel departure meaning when applicable." },
    { match: /\bboarding pass\b/, hint: "Keep the travel meaning of 'boarding pass'." },
    { match: /\btable for two\b/, hint: "Translate as a restaurant seating request." },
    { match: /\bwindow seat\b/, hint: "Translate as an airplane/train seat request when applicable." },
    { match: /\bduty free\b/, hint: "Treat 'duty free' as the airport shopping area, not a generic tax phrase." },
  ];

  const domainHints = [
    { match: /\bdoctor|ambulance|police|hospital|allergic|medication|fire\b/, hint: "Emergency/medical context: prefer urgent, direct, practical wording used in real emergency situations." },
    { match: /\breservation|room key|wifi password|clean the room|wake-up call|hot water|luggage|parking|swimming pool|check-?out\b/, hint: "Hotel context: prefer hospitality terminology used at reception or with hotel staff." },
    { match: /\bmenu|water, please|bill|table for two|not spicy|vegetarian|lactose|gluten|nuts\b/, hint: "Restaurant context: prefer natural service-industry wording a guest would say to staff." },
    { match: /\bpassport control|lost my luggage|gate|flight|boarding pass|window seat|duty free|city center\b/, hint: "Airport/travel context: prefer airport and transport terminology used in announcements and counters." },
    { match: /\bdiscount|bigger size|return this|credit cards|receipt|ship this|fitting rooms|pay in cash\b/, hint: "Shopping context: prefer wording used between customer and shop assistant." },
  ];

  if (mode === "phrases" || mode === "tourism" || mode === "question") {
    for (const item of tourismHints) {
      if (item.match.test(lower)) hints.push(item.hint);
    }
    for (const item of domainHints) {
      if (item.match.test(lower)) hints.push(item.hint);
    }
  }

  return [...new Set(hints)];
}

function needsFallbackTranslation(
  translated: string | null,
  originalText: string,
  sourceCode: string,
  targetCode: string,
): boolean {
  if (targetCode === sourceCode) return false;
  if (!translated) return true;
  return translated.trim().toLowerCase() === originalText.trim().toLowerCase();
}

function buildTranslationMessages(
  text: string,
  sourceLanguage: { code: string; name: string },
  targets: Array<{ code: string; name: string }>,
  mode: string,
  contextualHints: string[],
) {
  return [
    {
      role: "system" as const,
      content: [
        "You are a professional translator. Return only a JSON object.",
        "Keep the exact target language codes as keys.",
        "Preserve meaning, tone, names, numbers, currencies, URLs, emojis, and formatting.",
        "Do not explain.",
        "Do not transliterate unless needed for the target language.",
        "If the source is incomplete, translate naturally without inventing extra content.",
        ...getModeInstructions(mode),
        ...(contextualHints.length > 0 ? ["Use these glossary/context hints when relevant:", ...contextualHints] : []),
      ].join(" "),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        task: "translate_text",
        mode,
        source_language: sourceLanguage,
        targets,
        rules: {
          preserve_line_breaks: true,
          preserve_placeholders: true,
          preserve_proper_nouns: true,
          no_explanations: true,
        },
        text,
        output_schema: Object.fromEntries(targets.map((target) => [target.code, `translation in ${target.name}`])),
      }),
    },
  ];
}

async function requestSingleTranslation(
  text: string,
  sourceLanguage: { code: string; name: string },
  target: { code: string; name: string },
  model: string,
  mode: string,
  contextualHints: string[],
): Promise<string | null> {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.15,
    max_tokens: 1600,
    response_format: { type: "json_object" },
    messages: buildTranslationMessages(text, sourceLanguage, [target], mode, contextualHints),
  });
  return sanitizeTranslation(safeParseJson(response.choices[0].message.content)[target.code]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text, sourceLanguage, sourceLanguageName, targetLanguages, targetLanguageNames, model, mode, glossaryHints } = req.body;
    if (!text?.trim() || !targetLanguages?.length) return res.json({});
    const modelName = model || "gpt-4.1-mini";
    const translationMode = String(mode || "general");
    const source = {
      code: String(sourceLanguage || "").trim(),
      name: getPromptLanguageName(String(sourceLanguage || ""), sourceLanguageName),
    };
    const targets = normalizeTargets(targetLanguages, targetLanguageNames);
    if (!source.code || targets.length === 0) return res.json({});
    const contextualHints = buildGlossaryHints(text, translationMode, glossaryHints);

    const response = await client.chat.completions.create({
      model: modelName,
      temperature: 0.15,
      max_tokens: 1600,
      response_format: { type: "json_object" },
      messages: buildTranslationMessages(text, source, targets, translationMode, contextualHints),
    });
    const parsed = safeParseJson(response.choices[0].message.content);
    const result: Record<string, string> = {};
    const missingTargets: Array<{ code: string; name: string }> = [];

    for (const target of targets) {
      if (target.code === source.code) {
        result[target.code] = text.trim();
        continue;
      }
      const translated = sanitizeTranslation(parsed[target.code]);
      if (needsFallbackTranslation(translated, text, source.code, target.code)) {
        missingTargets.push(target);
        continue;
      }
      result[target.code] = translated!;
    }

    for (const target of missingTargets) {
      const translated = await requestSingleTranslation(text, source, target, modelName, translationMode, contextualHints);
      if (translated) {
        result[target.code] = translated;
      }
    }

    res.json(result);
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Translation failed", status });
  }
}
