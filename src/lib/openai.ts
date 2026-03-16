import OpenAI from "openai";
import { useUserStore } from "./store";
import { isConnectionSlow, isOnline as isOnlineCheck, reportResponseTime, canUseLocalTTS, playLocalTTS } from "./offline";

let client: OpenAI | null = null;
let currentKey: string = "";

export function getOpenAIClient(): OpenAI {
  return getClient();
}

function getClient(): OpenAI {
  const storeKey = useUserStore.getState().openaiApiKey;
  const envKey = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_OPENAI_API_KEY) || "";
  const apiKey = storeKey || envKey || "";

  if (!apiKey) {
    throw new Error("API key not configured. Go to Settings and enter your OpenAI API key.");
  }

  // Recreate client if key changed
  if (!client || apiKey !== currentKey) {
    currentKey = apiKey;
    client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }
  return client;
}

function getModels() {
  const state = useUserStore.getState();
  return {
    text: state.textModel || "gpt-4.1-mini",
    transcribe: state.transcribeModel || "gpt-4o-transcribe",
    tts: state.ttsModel || "gpt-4o-mini-tts",
  };
}

// ─── STT ────────────────────────────────────────────────────────────────────

export async function transcribeAudio(
  audioBlob: Blob,
  language?: string,
): Promise<string> {
  const file = new File([audioBlob], "audio.webm", { type: audioBlob.type });

  const response = await getClient().audio.transcriptions.create({
    model: getModels().transcribe,
    file,
    ...(language && language !== "auto" ? { language } : {}),
  });

  return response.text;
}

// ─── Translation ────────────────────────────────────────────────────────────

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguages: string[],
): Promise<Record<string, string>> {
  if (!text.trim() || targetLanguages.length === 0) return {};

  const start = Date.now();
  const response = await getClient().chat.completions.create({
    model: getModels().text,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a professional translator. Translate text naturally (not literally), preserving tone and context. Return ONLY a JSON object where keys are target language codes and values are translated strings.`,
      },
      {
        role: "user",
        content: `Translate from ${sourceLanguage} to ${targetLanguages.join(", ")}:\n\n"${text}"`,
      },
    ],
  });

  reportResponseTime(Date.now() - start);

  try {
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch {
    console.error("Translation parse error");
    return {};
  }
}

// ─── TTS ────────────────────────────────────────────────────────────────────

export type TTSVoice = "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";

// Detect Safari (doesn't support opus well, and blocks non-user-initiated audio)
const isSafari = typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export async function textToSpeech(
  text: string,
  voice: TTSVoice = "nova",
  speed: number = 1.0,
): Promise<ArrayBuffer> {
  const response = await getClient().audio.speech.create({
    model: getModels().tts,
    voice,
    input: text,
    speed,
    response_format: isSafari ? "mp3" : "opus",
  });

  return response.arrayBuffer();
}

// Pre-created audio element for Safari (must be created on user tap)
let _preAudio: HTMLAudioElement | null = null;

// Call this synchronously inside a tap/click handler BEFORE any await
export function prepareAudioForSafari() {
  if (!isSafari) return;
  _preAudio = new Audio();
  // Play silent to "unlock" audio context on Safari
  _preAudio.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwBHAAAAAAD/+1DEAAAHAAGf9AAAIgAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UMQbgAADSAAAAAAAAANIAAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";
  _preAudio.play().catch(() => {});
}

export async function playTTS(
  text: string,
  voice?: TTSVoice,
  speed: number = 1.0,
  langCode?: string,
): Promise<void> {
  // Use voice and speed from store if not explicitly provided
  const state = useUserStore.getState();
  const selectedVoice = (voice || state.ttsVoice || "nova") as TTSVoice;
  const selectedSpeed = speed !== 1.0 ? speed : (state.ttsSpeed || 1.0);

  // If connection is slow or offline, use local TTS
  if (isConnectionSlow() || !isOnlineCheck()) {
    if (canUseLocalTTS()) {
      return playLocalTTS(text, langCode);
    }
  }

  try {
    const start = Date.now();
    const buffer = await textToSpeech(text, selectedVoice, selectedSpeed);
    reportResponseTime(Date.now() - start);

    const mimeType = isSafari ? "audio/mpeg" : "audio/ogg; codecs=opus";
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);

    // On Safari, reuse the pre-created audio element (already unlocked)
    const audio = _preAudio || new Audio();
    _preAudio = null; // consume it
    audio.src = url;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        // Fallback to local TTS on playback error
        if (canUseLocalTTS()) {
          playLocalTTS(text, langCode).then(resolve).catch(reject);
        } else {
          reject(e);
        }
      };
      audio.play().catch((playErr) => {
        URL.revokeObjectURL(url);
        // Safari blocked — fallback to local TTS
        if (canUseLocalTTS()) {
          playLocalTTS(text, langCode).then(resolve).catch(reject);
        } else {
          reject(playErr);
        }
      });
    });
  } catch (e) {
    // Fallback to local TTS on any error
    if (canUseLocalTTS()) {
      return playLocalTTS(text, langCode);
    }
    throw e;
  }
}

// ─── Image analysis (vision) ────────────────────────────────────────────────

export interface ImageAnalysisResult {
  objectName: string;
  translation: string;
  pronunciation?: string;
}

export async function analyzeImage(
  imageBase64: string,
  targetLanguage: string,
  uiLanguage?: string,
): Promise<ImageAnalysisResult> {
  const nameLang = uiLanguage && uiLanguage !== "en" ? uiLanguage : "English";
  const response = await getClient().chat.completions.create({
    model: getModels().text,
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

  try {
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch {
    return { objectName: "Unknown", translation: "..." };
  }
}
