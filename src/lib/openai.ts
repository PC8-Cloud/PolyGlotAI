import { useUserStore } from "./store";
import { getPromptLanguageName } from "./languages";
import { isConnectionSlow, isOnline as isOnlineCheck, reportResponseTime, canUseLocalTTS, playLocalTTS, getLastResponseTime } from "./offline";

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

export type EffectiveTranslationPerformance = "fast" | "balanced";

export function getEffectiveTranslationPerformance(targetCount = 1): EffectiveTranslationPerformance {
  const { translationPerformance } = useUserStore.getState();
  if (translationPerformance === "fast" || translationPerformance === "balanced") {
    return translationPerformance;
  }

  const lastResponse = getLastResponseTime();
  if (!isOnlineCheck() || isConnectionSlow()) return "fast";
  if (lastResponse > 2200) return "fast";
  if (targetCount >= 4) return "fast";
  return "balanced";
}

export function getRealtimeTranslationConfig(targetCount = 1) {
  const profile = getEffectiveTranslationPerformance(targetCount);
  return profile === "fast"
    ? {
        profile,
        previewMinChars: 36,
        previewMinWords: 6,
        recomputeFinalAfterPreview: false,
      }
    : {
        profile,
        previewMinChars: 24,
        previewMinWords: 4,
        recomputeFinalAfterPreview: true,
      };
}

const TRANSLATION_CACHE_LIMIT = 120;
const translationCache = new Map<string, Record<string, string>>();
const inFlightTranslations = new Map<string, Promise<Record<string, string>>>();

function buildTranslationCacheKey(
  text: string,
  sourceLanguage: string,
  targetLanguages: string[],
  mode: string,
  glossaryHints: string[],
) {
  return JSON.stringify({
    text: text.trim(),
    sourceLanguage,
    targetLanguages: [...targetLanguages].sort(),
    mode,
    glossaryHints: [...glossaryHints].sort(),
  });
}

function readTranslationCache(cacheKey: string): Record<string, string> | null {
  const cached = translationCache.get(cacheKey);
  if (!cached) return null;
  // LRU touch
  translationCache.delete(cacheKey);
  translationCache.set(cacheKey, cached);
  return { ...cached };
}

function writeTranslationCache(cacheKey: string, value: Record<string, string>) {
  translationCache.set(cacheKey, { ...value });
  if (translationCache.size > TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) translationCache.delete(oldestKey);
  }
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
  expectedLanguages?: string[],
): Promise<{ text: string; language: string }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", getModels().transcribe);
  formData.append("detect_language", "true");
  if (Array.isArray(expectedLanguages) && expectedLanguages.length > 0) {
    formData.append("expected_languages", expectedLanguages.join(","));
  }

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

export interface TimestampedSegment {
  start: number;
  end: number;
  text: string;
}

export async function transcribeMediaWithTimestamps(
  mediaBlob: Blob,
): Promise<{ text: string; language: string; segments: TimestampedSegment[] }> {
  const formData = new FormData();
  formData.append("file", mediaBlob, "media.mp4");
  formData.append("include_timestamps", "true");
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
  const segments = Array.isArray(data?.segments)
    ? data.segments
      .map((s: any) => ({
        start: Number.isFinite(s?.start) ? Number(s.start) : 0,
        end: Number.isFinite(s?.end) ? Number(s.end) : 0,
        text: typeof s?.text === "string" ? s.text.trim() : "",
      }))
      .filter((s: TimestampedSegment) => s.text)
    : [];

  return {
    text: typeof data?.text === "string" ? data.text : "",
    language: typeof data?.language === "string" ? data.language : "",
    segments,
  };
}

// ─── Translation ────────────────────────────────────────────────────────────

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguages: string[],
  options?: {
    mode?: "general" | "live" | "phrases" | "tourism" | "room" | "question";
    glossaryHints?: string[];
    cache?: boolean;
  },
): Promise<Record<string, string>> {
  if (!text.trim() || targetLanguages.length === 0) return {};

  const uniqueTargets = [...new Set(targetLanguages.filter(Boolean))];
  const normalizedSource = sourceLanguage.trim();
  const mode = options?.mode || "general";
  const glossaryHints = options?.glossaryHints || [];
  const useCache = options?.cache !== false;
  const cacheKey = buildTranslationCacheKey(text, normalizedSource, uniqueTargets, mode, glossaryHints);

  if (useCache) {
    const cached = readTranslationCache(cacheKey);
    if (cached) return cached;
    const inFlight = inFlightTranslations.get(cacheKey);
    if (inFlight) return inFlight;
  }

  const request = (async () => {
    const start = Date.now();
    const response = await withRetry(() =>
      apiFetch("translate", {
        text,
        sourceLanguage: normalizedSource,
        sourceLanguageName: getPromptLanguageName(normalizedSource),
        targetLanguages: uniqueTargets,
        targetLanguageNames: Object.fromEntries(
          uniqueTargets.map((lang) => [lang, getPromptLanguageName(lang)])
        ),
        mode,
        glossaryHints,
        model: getModels().text,
      })
    );

    reportResponseTime(Date.now() - start);

    try {
      const data = await response.json();
      const cleaned: Record<string, string> = {};

      for (const lang of uniqueTargets) {
        if (lang === normalizedSource) {
          cleaned[lang] = text;
          continue;
        }
        const translated = data?.[lang];
        if (typeof translated === "string" && translated.trim()) {
          cleaned[lang] = translated.trim();
        }
      }

      if (useCache && Object.keys(cleaned).length > 0) {
        writeTranslationCache(cacheKey, cleaned);
      }
      return cleaned;
    } catch {
      console.error("Translation parse error");
      return {};
    } finally {
      inFlightTranslations.delete(cacheKey);
    }
  })();

  if (useCache) {
    inFlightTranslations.set(cacheKey, request);
  }

  return request;
}

// ─── UI Translation (for i18n dynamic translations) ─────────────────────────

export async function translateUIChunk(
  sourceObj: Record<string, string>,
  targetLanguageCode: string,
  targetLanguageName?: string,
): Promise<Record<string, string>> {
  const response = await withRetry(() =>
    apiFetch("translate-ui", {
      sourceObj,
      targetLanguageCode,
      targetLanguageName: targetLanguageName || getPromptLanguageName(targetLanguageCode),
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

export type TTSVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "sage"
  | "shimmer"
  | string;

export interface OpenAIVoiceConsent {
  id: string;
  name: string;
  language: string;
  created_at?: number;
}

export interface OpenAICustomVoice {
  id: string;
  name: string;
  created_at?: number;
}

// Gender-aware voice mapping per language
// Male voices: echo, onyx, ash, fable
// Female voices: nova, shimmer, alloy, coral, sage, ballad
const AUTO_TTS_VOICE_BY_LANG_FEMALE: Record<string, TTSVoice> = {
  it: "sage",
  en: "nova",
  de: "alloy",
  es: "coral",
  fr: "shimmer",
  pt: "nova",
  zh: "ballad",
  ja: "alloy",
  ko: "ballad",
  ar: "sage",
};

const AUTO_TTS_VOICE_BY_LANG_MALE: Record<string, TTSVoice> = {
  it: "ash",
  en: "echo",
  de: "onyx",
  es: "fable",
  fr: "echo",
  pt: "onyx",
  zh: "echo",
  ja: "ash",
  ko: "ash",
  ar: "fable",
};

export function getAutoVoiceForLanguage(langCode?: string, gender?: "male" | "female" | ""): TTSVoice {
  const base = String(langCode || "").toLowerCase().split("-")[0];
  if (gender === "male") return AUTO_TTS_VOICE_BY_LANG_MALE[base] || "echo";
  if (gender === "female") return AUTO_TTS_VOICE_BY_LANG_FEMALE[base] || "nova";
  // Default: use female voices (backward compatible)
  return AUTO_TTS_VOICE_BY_LANG_FEMALE[base] || "nova";
}

export async function listOpenAIVoices(): Promise<OpenAICustomVoice[]> {
  const response = await withRetry(async () => {
    const res = await fetch("/api/voice-clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_voices" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "List voices failed", status: res.status }));
      throw new ApiError(err.error || "List voices failed", err.status || res.status);
    }
    return res;
  });
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

export async function listOpenAIVoiceConsents(): Promise<OpenAIVoiceConsent[]> {
  const response = await withRetry(async () => {
    const res = await fetch("/api/voice-clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_consents" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "List consents failed", status: res.status }));
      throw new ApiError(err.error || "List consents failed", err.status || res.status);
    }
    return res;
  });
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

export async function createOpenAIVoiceConsent(
  name: string,
  language: string,
  recordingBase64: string,
): Promise<OpenAIVoiceConsent> {
  const response = await withRetry(async () => {
    const res = await fetch("/api/voice-clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_consent",
        name,
        language,
        recordingBase64,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Create consent failed", status: res.status }));
      throw new ApiError(err.error || "Create consent failed", err.status || res.status);
    }
    return res;
  });
  return response.json();
}

export async function createOpenAICustomVoice(
  name: string,
  consentId: string,
  audioSampleBase64: string,
): Promise<OpenAICustomVoice> {
  const response = await withRetry(async () => {
    const res = await fetch("/api/voice-clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_voice",
        name,
        consentId,
        audioSampleBase64,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Create voice failed", status: res.status }));
      throw new ApiError(err.error || "Create voice failed", err.status || res.status);
    }
    return res;
  });
  return response.json();
}

// Detect Safari (doesn't support opus well, and blocks non-user-initiated audio)
const isSafari = typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export async function textToSpeech(
  text: string,
  voice?: TTSVoice,
  speed: number = 1.0,
  langCode?: string,
): Promise<ArrayBuffer> {
  const selectedVoice = voice || getAutoVoiceForLanguage(langCode);
  const format = isSafari ? "mp3" : "opus";
  const response = await withRetry(async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: selectedVoice,
        speed,
        langCode,
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

function normalizeTextForSpeech(text: string, langCode?: string): string {
  let out = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();

  // Remove markdown artifacts that hurt pronunciation.
  out = out.replace(/[*_`#]+/g, "");

  // Expand common separators for cleaner prosody.
  out = out.replace(/\s*\/\s*/g, " / ");
  out = out.replace(/\s*-\s*/g, " - ");

  // Ensure terminal punctuation (helps intonation in short utterances).
  if (out && !/[.!?…]$/.test(out)) {
    out += ".";
  }

  const lc = String(langCode || "").toLowerCase().split("-")[0];
  if (lc === "it") {
    // Better Italian rhythm for short translated phrases.
    out = out.replace(/,(\S)/g, ", $1");
  }
  return out;
}

// ─── Audio playback engine (iOS/Android compatible) ─────────────────────────

let _audioCtx: AudioContext | null = null;
// Pre-warmed Audio element — created on user gesture, reused for playback
let _warmAudio: HTMLAudioElement | null = null;
const AUDIO_DEBUG = typeof import.meta !== "undefined" ? Boolean((import.meta as any).env?.DEV) : false;

// Tiny silent MP3 (1 frame) — just to unlock playback
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwLHAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwLHAAAAAAAAAAAAAAAAAAAA";

// Call this synchronously inside EVERY tap/click handler to unlock audio on iOS.
// Creates AudioContext + warms an Audio element with a silent data URI.
export function prepareAudioForSafari() {
  if (AUDIO_DEBUG) console.log("[Audio] prepareAudioForSafari", { audioCtxState: _audioCtx?.state, hasWarmAudio: !!_warmAudio });
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
  if (AUDIO_DEBUG) console.log("[Audio] suspendAudioForMic", { audioCtxState: _audioCtx?.state, hasWarmAudio: !!_warmAudio });
  if (_audioCtx?.state === "running") {
    _audioCtx.suspend().catch(() => {});
  }
  // Also stop any playing warm audio
  if (_warmAudio) {
    _warmAudio.pause();
    _warmAudio.currentTime = 0;
  }
}

/** Mute: stop current playback but keep AudioContext alive for future use. */
export function muteAudio() {
  if (AUDIO_DEBUG) console.log("[Audio] muteAudio", { audioCtxState: _audioCtx?.state, hasWarmAudio: !!_warmAudio });
  // Suspend (not close) AudioContext — stops current BufferSource nodes
  if (_audioCtx?.state === "running") {
    _audioCtx.suspend().catch(() => {});
  }
  // Pause warm audio element
  if (_warmAudio) {
    _warmAudio.pause();
    _warmAudio.currentTime = 0;
  }
  // Pause any other audio elements on the page
  document.querySelectorAll("audio").forEach((a) => {
    a.pause();
    a.currentTime = 0;
  });
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }
}

/** Stop all audio playback immediately (for background/visibility change).
 *  Closes AudioContext and nulls refs so they get re-created fresh on next user gesture. */
export function stopAllAudio() {
  if (AUDIO_DEBUG) console.log("[Audio] stopAllAudio", { audioCtxState: _audioCtx?.state, hasWarmAudio: !!_warmAudio });
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
  gender?: "male" | "female" | "",
): Promise<void> {
  const state = useUserStore.getState();
  // Use custom cloned voice if available, then gender-aware auto voice, then store preference
  // Gender-aware selection takes priority over store default when gender is specified
  const selectedVoice = (voice || state.customVoiceId || (gender ? getAutoVoiceForLanguage(langCode, gender) : null) || state.ttsVoice || getAutoVoiceForLanguage(langCode) || "nova") as TTSVoice;
  const userSpeed = state.ttsSpeed || 1.0;
  const baseSpeed = typeof speed === "number" ? speed : 1.0;
  const selectedSpeed = Math.max(0.7, Math.min(1.8, baseSpeed * userSpeed));
  const spokenText = normalizeTextForSpeech(text, langCode);

  // If connection is slow or offline, use local TTS
  if (isConnectionSlow() || !isOnlineCheck()) {
    if (canUseLocalTTS()) {
      if (AUDIO_DEBUG) console.log("[Audio] playTTS -> localTTS", { langCode, textPreview: spokenText.slice(0, 60) });
      return playLocalTTS(spokenText, langCode);
    }
  }

  try {
    if (AUDIO_DEBUG) console.log("[Audio] playTTS start", { langCode, voice: selectedVoice, speed: selectedSpeed, textPreview: spokenText.slice(0, 60), audioCtxState: _audioCtx?.state });
    const start = Date.now();
    const buffer = await textToSpeech(spokenText, selectedVoice, selectedSpeed, langCode);
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
          source.onended = () => {
            if (AUDIO_DEBUG) console.log("[Audio] playTTS end via AudioContext", { langCode, textPreview: spokenText.slice(0, 60) });
            resolve();
          };
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
        if (AUDIO_DEBUG) console.log("[Audio] playTTS end via HTMLAudio", { langCode, textPreview: spokenText.slice(0, 60) });
        resolve();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        if (AUDIO_DEBUG) console.warn("[Audio] playTTS HTMLAudio error", e);
        if (canUseLocalTTS()) {
          playLocalTTS(spokenText, langCode).then(resolve).catch(reject);
        } else {
          reject(e);
        }
      };
      audio.play().catch((playErr) => {
        URL.revokeObjectURL(url);
        if (AUDIO_DEBUG) console.warn("[Audio] playTTS audio.play() rejected", playErr);
        if (canUseLocalTTS()) {
          playLocalTTS(spokenText, langCode).then(resolve).catch(reject);
        } else {
          reject(playErr);
        }
      });
    });
  } catch (e) {
    if (AUDIO_DEBUG) console.warn("[Audio] playTTS failed, trying fallback", e);
    if (canUseLocalTTS()) {
      return playLocalTTS(spokenText, langCode);
    }
    throw e;
  }
}

// ─── Image analysis (vision) ────────────────────────────────────────────────

export interface ImageAnalysisResult {
  mode?: "ocr" | "object";
  detectedLanguage?: string;
  extractedText?: string;
  translatedText?: string;
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
