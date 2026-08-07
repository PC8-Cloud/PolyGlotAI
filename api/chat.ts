import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { requireApiAccess } from "./auth.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface TutorPayload {
  text: string;
  translation: string;
  correction: string | null;
  hint: string | null;
}

function parseJsonPayload(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") {
    return content && typeof content === "object" ? (content as Record<string, unknown>) : null;
  }

  const trimmed = content.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeTutorPayload(content: unknown): TutorPayload {
  const parsed = parseJsonPayload(content);
  const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
  const translation = typeof parsed?.translation === "string" ? parsed.translation.trim() : "";
  const correction =
    typeof parsed?.correction === "string" && parsed.correction.trim()
      ? parsed.correction.trim()
      : null;
  const hint =
    typeof parsed?.hint === "string" && parsed.hint.trim()
      ? parsed.hint.trim()
      : null;

  if (text || translation || correction || hint) {
    return { text, translation, correction, hint };
  }

  const fallback = typeof content === "string" ? content.trim() : "";
  return {
    text: fallback,
    translation: "",
    correction: null,
    hint: null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const access = await requireApiAccess(req, res, {
    feature: "conversation",
    quotaKey: "text_translate_requests",
    quotaAmount: 1,
  });
  if (!access) return;

  try {
    const { messages } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });
    // The client assembles the tutor conversation (including its system
    // prompt), which makes this endpoint usable as a generic LLM by anyone
    // with a token. Bound the blast radius: generous caps that a real Learn
    // session never hits, and the cheap model regardless of what was asked.
    if (messages.length > 80) {
      return res.status(400).json({ error: "too many messages", status: 400 });
    }
    const totalChars = messages.reduce(
      (sum: number, m: any) => sum + String(m?.content ?? "").length,
      0,
    );
    if (totalChars > 60000) {
      return res.status(400).json({ error: "conversation too large", status: 400 });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages,
    });

    const content = response.choices[0].message.content || "{}";
    res.json(normalizeTutorPayload(content));
  } catch (err: any) {
    const status = err?.status || 500;
    console.error("[api/chat]", JSON.stringify({ status, error: err?.message }));
    res.status(status).json({ error: err?.message || "Chat failed", status });
  }
}
