import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiAccess } from "./auth";

const OPENAI_API_BASE = "https://api.openai.com/v1";

function getApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function toBuffer(base64: string): Buffer {
  const clean = String(base64 || "").trim();
  if (!clean) throw new Error("empty_base64");
  return Buffer.from(clean, "base64");
}

function extractDataUrl(input: string): { base64: string; mimeType: string } {
  const value = String(input || "");
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { base64: value, mimeType: "audio/wav" };
  }
  return { mimeType: match[1], base64: match[2] };
}

async function openaiJson(path: string, init?: RequestInit) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch(`${OPENAI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error?.message || `OpenAI request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const access = await requireApiAccess(req, res, { feature: "voiceClone", paidOnly: true });
  if (!access) return;

  try {
    const { action } = req.body || {};

    if (action === "list_voices") {
      const data = await openaiJson("/audio/voices");
      return res.json(data);
    }

    if (action === "list_consents") {
      const data = await openaiJson("/audio/voice_consents");
      return res.json(data);
    }

    if (action === "create_consent") {
      const { name, language, recordingBase64 } = req.body || {};
      if (!name || !language || !recordingBase64) {
        return res.status(400).json({ error: "name, language, recordingBase64 required" });
      }

      const parsed = extractDataUrl(String(recordingBase64));
      const recording = new Blob([toBuffer(parsed.base64)], { type: parsed.mimeType || "audio/wav" });
      const form = new FormData();
      form.append("name", String(name));
      form.append("language", String(language));
      form.append("recording", recording, "consent.wav");

      const data = await openaiJson("/audio/voice_consents", {
        method: "POST",
        body: form,
      });
      return res.json(data);
    }

    if (action === "create_voice") {
      const { name, consentId, audioSampleBase64 } = req.body || {};
      if (!name || !consentId || !audioSampleBase64) {
        return res.status(400).json({ error: "name, consentId, audioSampleBase64 required" });
      }

      const parsed = extractDataUrl(String(audioSampleBase64));
      const sample = new Blob([toBuffer(parsed.base64)], { type: parsed.mimeType || "audio/wav" });
      const form = new FormData();
      form.append("name", String(name));
      form.append("consent", String(consentId));
      form.append("audio_sample", sample, "sample.wav");

      const data = await openaiJson("/audio/voices", {
        method: "POST",
        body: form,
      });
      return res.json(data);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err: any) {
    const message = err?.message || "Voice clone request failed";
    return res.status(500).json({ error: message });
  }
}
