import { useUserStore } from "./store";
import { isConnectionSlow, isOnline as isOnlineCheck, reportResponseTime, canUseLocalTTS, playLocalTTS } from "./offline";

// ─── User-friendly API error messages ────────────────────────────────────────

export function getApiErrorMessage(err: any): { key: string; fallback: string } {
  const status = err?.status || err?.response?.status || 0;
  const msg = err?.message || String(err);

  if (msg.includes("API key") || status === 401) {
    return { key: "apiKeyExpired", fallback: "Your API key has expired" };
  }
  if (status === 402 || status === 403 || msg.includes("insufficient_quota") || msg.includes("billing")) {
    return { key: "apiKeyExpired", fallback: "Your API key has expired" };
  }
  if (!navigator.onLine) {
    return { key: "requiresInternet", fallback: "Requires internet" };
  }
  // Everything else: transient/network/overload — just say "try again"
  return { key: "genericApiError", fallback: "Temporary error. Try again." };
}

// ─── Retry with exponential backoff for transient errors ─────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 0;
      const isTransient = [429, 500, 502, 503, 529].includes(status);
      if (!isTransient || attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      console.warn(`API ${status}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ─── API fetch helper ────────────────────────────────────────────────────────

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(endpoint: string, body: any): Promise<Response> {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed", status: res.status }));
    throw new ApiError(err.error || "Request failed", err.status || res.status);
  }
  return res;
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
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  if (language && language !== "auto") formData.append("language", language);
  formData.append("model", getModels().transcribe);

  const response = await withRetry(async () => {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Transcription failed", status: res.status }));
      throw new ApiError(err.error || "Transcription failed", err.status || res.status);
    }
    return res;
  });

  const data = await response.json();
  return data.text;
}

// ─── Translation ────────────────────────────────────────────────────────────

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguages: string[],
): Promise<Record<string, string>> {
  if (!text.trim() || targetLanguages.length === 0) return {};

  const start = Date.now();
  const response = await withRetry(() =>
    apiFetch("translate", {
      text,
      sourceLanguage,
      targetLanguages,
      model: getModels().text,
    })
  );

  reportResponseTime(Date.now() - start);

  try {
    return await response.json();
  } catch {
    console.error("Translation parse error");
    return {};
  }
}

// ─── UI Translation (for i18n dynamic translations) ─────────────────────────

export async function translateUIChunk(
  sourceObj: Record<string, string>,
  targetLanguage: string,
): Promise<Record<string, string>> {
  const response = await withRetry(() =>
    apiFetch("translate-ui", {
      sourceObj,
      targetLanguage,
      model: "gpt-4o",
    })
  );

  try {
    return await response.json();
  } catch {
    return sourceObj; // fallback to English
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
  const format = isSafari ? "mp3" : "opus";
  const response = await withRetry(async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice,
        speed,
        format,
        model: getModels().tts,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "TTS failed", status: res.status }));
      throw new ApiError(err.error || "TTS failed", err.status || res.status);
    }
    return res;
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
  const response = await withRetry(() =>
    apiFetch("analyze-image", {
      imageBase64,
      targetLanguage,
      uiLanguage,
      model: getModels().text,
    })
  );

  try {
    return await response.json();
  } catch {
    return { objectName: "Unknown", translation: "..." };
  }
}
