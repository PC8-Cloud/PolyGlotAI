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

/** Transcribe audio AND detect language (for conversation auto-detect) */
export async function transcribeAudioDetectLang(
  audioBlob: Blob,
): Promise<{ text: string; language: string }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", getModels().transcribe);
  formData.append("detect_language", "true");

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
  return { text: data.text || "", language: data.language || "" };
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

// ─── Audio playback engine (iOS/Android compatible) ─────────────────────────

let _audioCtx: AudioContext | null = null;
// Pre-warmed Audio element — created on user gesture, reused for playback
let _warmAudio: HTMLAudioElement | null = null;

// Tiny silent MP3 (1 frame) — just to unlock playback
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwLHAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwLHAAAAAAAAAAAAAAAAAAAA";

// Call this synchronously inside EVERY tap/click handler to unlock audio on iOS.
// Creates AudioContext + warms an Audio element with a silent data URI.
export function prepareAudioForSafari() {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;

  // If AudioContext is closed (e.g. after stopAllAudio), discard and recreate
  if (_audioCtx?.state === "closed") {
    _audioCtx = null;
  }

  if (AudioCtx && !_audioCtx) {
    _audioCtx = new AudioCtx();
  }
  if (_audioCtx?.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }

  // Re-warm HTMLAudioElement if needed (after stopAllAudio nulls it)
  if (!_warmAudio) {
    _warmAudio = new Audio();
    _warmAudio.src = SILENT_MP3;
    _warmAudio.load();
    _warmAudio.play().catch(() => {});
  }
}

// Suspend AudioContext to release audio session (call before recording).
// On mobile, the audio session can conflict with the microphone.
export function suspendAudioForMic() {
  if (_audioCtx?.state === "running") {
    _audioCtx.suspend().catch(() => {});
  }
  // Also stop any playing warm audio
  if (_warmAudio) {
    _warmAudio.pause();
    _warmAudio.currentTime = 0;
  }
}

/** Stop all audio playback immediately (for background/visibility change).
 *  Closes AudioContext and nulls refs so they get re-created fresh on next user gesture. */
export function stopAllAudio() {
  // Close AudioContext entirely — suspend isn't enough on some mobile browsers
  if (_audioCtx) {
    _audioCtx.close().catch(() => {});
    _audioCtx = null;
  }
  // Destroy warm audio element
  if (_warmAudio) {
    _warmAudio.pause();
    _warmAudio.currentTime = 0;
    _warmAudio = null;
  }
  // Stop any other audio elements on the page
  document.querySelectorAll("audio").forEach((a) => {
    a.pause();
    a.currentTime = 0;
  });
  // Cancel speechSynthesis if running
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }
}

export async function playTTS(
  text: string,
  voice?: TTSVoice,
  speed: number = 1.0,
  langCode?: string,
): Promise<void> {
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

    // Strategy 1: AudioContext (best for iOS — stays unlocked after initial gesture)
    if (_audioCtx) {
      if (_audioCtx.state === "closed") {
        _audioCtx = null;
      } else if (_audioCtx.state === "suspended") {
        try { await _audioCtx.resume(); } catch {}
      }
    }
    if (_audioCtx?.state === "running") {
      try {
        const audioData = await _audioCtx.decodeAudioData(buffer.slice(0));
        const source = _audioCtx.createBufferSource();
        source.buffer = audioData;
        source.connect(_audioCtx.destination);
        source.start();
        return new Promise<void>((resolve) => {
          source.onended = () => resolve();
        });
      } catch (decodeErr) {
        console.warn("AudioContext decode failed, trying Audio element:", decodeErr);
      }
    }

    // Strategy 2: HTMLAudioElement with blob URL
    const mimeType = isSafari ? "audio/mpeg" : "audio/ogg; codecs=opus";
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);

    // Reuse the pre-warmed Audio element if available (already unlocked on iOS)
    const audio = _warmAudio || new Audio();
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
