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

// AudioContext for reliable playback (survives async gaps on Safari)
let _audioCtx: AudioContext | null = null;

// Call this synchronously inside a tap/click handler to create AudioContext
// (must be created during user gesture on iOS, resume happens before playback)
export function prepareAudioForSafari() {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;
  if (!_audioCtx) {
    _audioCtx = new AudioCtx();
    // Initial resume to "unlock" on user gesture — will be suspended after first playback
    _audioCtx.resume().catch(() => {});
  }
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

    // Try AudioContext first (works reliably on Safari after unlock)
    if (_audioCtx) {
      // Resume if suspended (was suspended after previous playback)
      if (_audioCtx.state === "suspended") {
        try { await _audioCtx.resume(); } catch {}
      }
      if (_audioCtx.state === "running") {
        try {
          const audioData = await _audioCtx.decodeAudioData(buffer.slice(0));
          const source = _audioCtx.createBufferSource();
          source.buffer = audioData;
          source.connect(_audioCtx.destination);
          source.start();
          return new Promise<void>((resolve) => {
            source.onended = () => {
              // Suspend AudioContext after playback to free audio session for mic
              if (_audioCtx) _audioCtx.suspend().catch(() => {});
              resolve();
            };
          });
        } catch (decodeErr) {
          console.warn("AudioContext decode failed, falling back to Audio element:", decodeErr);
        }
      }
    }

    // Fallback: HTMLAudioElement
    const mimeType = isSafari ? "audio/mpeg" : "audio/ogg; codecs=opus";
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.src = url;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        if (canUseLocalTTS()) {
          playLocalTTS(text, langCode).then(resolve).catch(reject);
        } else {
          reject(e);
        }
      };
      audio.play().catch((playErr) => {
        URL.revokeObjectURL(url);
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
