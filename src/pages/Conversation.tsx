import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, MicOff, Send, Volume2, VolumeX, ArrowRightLeft, Check, CheckCheck, Upload, MessagesSquare } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLabelForCode } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { translateText, playTTS, prepareAudioForSafari, muteAudio, getApiErrorMessage, transcribeAudioDetectLang, suspendAudioForMic, withTimeout } from "../lib/openai";
import { detectPitch, classifyGender } from "../lib/gender-detect";

// Hard cap on a single TTS playback so a suspended AudioContext (screen off,
// app backgrounded) cannot deadlock the conversation loop.
const TTS_PLAYBACK_TIMEOUT_MS = 90_000;
import { consumeTrialQuota, getTrialUpgradeMessage } from "../lib/trial";

type MsgStatus = "sent" | "translated" | "playing" | "done";

interface Message {
  id: number;
  side: "you" | "them";
  originalText: string;
  translatedText: string;
  sourceLang: string;
  status: MsgStatus;
  gender?: "male" | "female" | "";
}


// Silence detection — adaptive timeout based on speech duration
// Short speech → shorter pause tolerance, long speech → more patience for natural pauses
const SILENCE_TIMEOUT_SHORT = 1.8; // after < 3s of speech: probably a short reply
const SILENCE_TIMEOUT_NORMAL = 2.8; // after 3-8s of speech: normal sentence
const SILENCE_TIMEOUT_LONG = 3.8; // after > 8s of speech: longer monologue, allow thinking pauses
const SILENCE_THRESHOLD = 0.06;
const VOICE_ACTIVITY_THRESHOLD = 0.07;
const VOICE_ACTIVITY_FRAMES = 4;
const NO_SPEECH_TIMEOUT_MS = 4500;
const MIN_SPEECH_DURATION_MS = 420;
const SPEECH_PEAK_THRESHOLD = 0.12;
const WEAK_PEAK_THRESHOLD = 0.08;
const MIN_AVG_RMS_THRESHOLD = 0.06;
const MIN_AUDIO_BLOB_BYTES = 1000;
const MAX_DUPLICATE_SIMILARITY = 0.8; // reject if >80% similar to a recent message
const CONVERSATION_DEBUG = typeof import.meta !== "undefined" ? Boolean((import.meta as any).env?.DEV) : false;

function isLikelyPromptLeakTranscript(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("transcribe only spoken words") ||
    lower.includes("avoid filler hallucinations") ||
    lower.includes("preserve punctuation when clear") ||
    lower.includes("trascrivi solo le parole pronunciate") ||
    lower.includes("evita riempitivi inutili") ||
    lower.includes("conserva la punteggiatura") ||
    lower.includes("likely spoken languages") ||
    lower.includes("spoken words") ||
    lower.includes("filler hallucinations") ||
    /transcri(be|vi)\s.*(words|parole)/i.test(text) ||
    /punctuation|punteggiatura/i.test(text) && /transcri|trascrivi|spoken|pronunciat/i.test(text)
  );
}

/** Simple text similarity (0-1) based on common words */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  wordsA.forEach((w) => { if (wordsB.has(w)) common++; });
  return common / Math.max(wordsA.size, wordsB.size);
}

/** Play a short two-note ascending chime to signal recording cutoff */
function playCutoffChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Note 1: E5 (659 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 659;
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Note 2: G5 (784 Hz) — slightly delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 784;
    gain2.gain.setValueAtTime(0.3, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.3);

    // Cleanup
    osc2.onended = () => ctx.close().catch(() => {});

    // Vibrate if supported (short pulse)
    if (navigator.vibrate) navigator.vibrate(100);
  } catch {
    // Audio not available — silent fallback
  }
}

const LANGUAGE_HINTS: Record<string, string[]> = {
  en: ["the", "a", "an", "and", "is", "are", "do", "does", "did", "have", "has", "you", "we", "they", "can"],
  it: ["il", "lo", "la", "gli", "le", "un", "una", "e", "sei", "sono", "hai", "avete", "come", "dove", "perche"],
  es: ["el", "la", "los", "las", "un", "una", "y", "es", "eres", "tienes", "como", "donde", "por", "que"],
  fr: ["le", "la", "les", "un", "une", "et", "est", "suis", "etes", "avez", "comme", "ou", "pourquoi"],
  de: ["der", "die", "das", "ein", "eine", "und", "ist", "sind", "hast", "haben", "wie", "wo", "warum"],
};

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ["english", "inglese", "inglés", "anglais", "englisch"],
  de: ["german", "deutsch", "tedesco", "alemán", "allemand"],
  it: ["italian", "italiano", "italien"],
  es: ["spanish", "espanol", "español", "spagnolo", "espagnol", "spanisch"],
  fr: ["french", "francais", "français", "francese", "franzosisch", "französisch"],
  pt: ["portuguese", "portugues", "português", "portoghese", "portugiesisch", "portugiesisch"],
};

function languageScoreFromText(text: string, langCode: string): number {
  const base = String(langCode || "").toLowerCase().split("-")[0];
  const hints = LANGUAGE_HINTS[base];
  if (!hints) return 0;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 0;
  let score = 0;
  for (const word of words) {
    if (hints.includes(word)) score += 1;
  }
  return score;
}


export default function Conversation() {
  const navigate = useNavigate();
  const { uiLanguage, userGender } = useUserStore();
  const t = useTranslation(uiLanguage);
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");

  const [yourLang, setYourLang] = useState(uiLanguage);
  const [theirLang, setTheirLang] = useState(
    uiLanguage === "en" ? "it" : "en",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatState, setChatState] = useState<"idle" | "listening" | "transcribing" | "translating" | "speaking">("idle");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [conversationActive, setConversationActive] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [textInputSide, setTextInputSide] = useState<"you" | "them">("you");
  const [showTextInput, setShowTextInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrialUpgradeModal, setShowTrialUpgradeModal] = useState(false);
  const [liveLevel, setLiveLevel] = useState(0); // mic audio level for visual feedback

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const msgIdRef = useRef(0);
  const conversationActiveRef = useRef(false);
  const processingRef = useRef(false);
  const yourLangRef = useRef(yourLang);
  const theirLangRef = useRef(theirLang);
  const autoSpeakRef = useRef(autoSpeak);

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peakLevelRef = useRef(0); // track peak audio level during recording
  const rmsAccRef = useRef({ sum: 0, count: 0 }); // accumulate RMS samples for average
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechCaptureRef = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const keepAliveCtxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);
  const wakeLockReleaseHandlerRef = useRef<(() => void) | null>(null);
  const detectedGenderRef = useRef<"male" | "female" | "">("");
  const lastDetectedSideRef = useRef<"you" | "them" | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatState]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { yourLangRef.current = yourLang; }, [yourLang]);
  useEffect(() => { theirLangRef.current = theirLang; }, [theirLang]);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => { conversationActiveRef.current = conversationActive; }, [conversationActive]);

  const startKeepAliveFallback = useCallback(async () => {
    if (keepAliveCtxRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 30;
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      await ctx.resume();
      keepAliveCtxRef.current = ctx;
      keepAliveOscRef.current = oscillator;
    } catch {
      // best effort
    }
  }, []);

  const stopKeepAliveFallback = useCallback(() => {
    try {
      keepAliveOscRef.current?.stop();
    } catch {}
    keepAliveOscRef.current = null;
    if (keepAliveCtxRef.current) {
      keepAliveCtxRef.current.close().catch(() => {});
      keepAliveCtxRef.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      if (!conversationActiveRef.current) return;
      if (!("wakeLock" in navigator)) return;
      if (wakeLockRef.current) return;
      const lock = await (navigator as any).wakeLock.request("screen");
      const handleRelease = () => {
        wakeLockRef.current = null;
        if (conversationActiveRef.current && document.visibilityState === "visible") {
          void acquireWakeLock();
        } else {
          startKeepAliveFallback();
        }
      };
      lock.addEventListener?.("release", handleRelease);
      wakeLockReleaseHandlerRef.current = handleRelease;
      wakeLockRef.current = lock;
      stopKeepAliveFallback();
    } catch {
      // Fallback for browsers where Screen Wake Lock is unavailable/restricted.
      startKeepAliveFallback();
    }
  }, [startKeepAliveFallback, stopKeepAliveFallback]);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      if (wakeLockReleaseHandlerRef.current) {
        wakeLockRef.current.removeEventListener?.("release", wakeLockReleaseHandlerRef.current);
      }
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    wakeLockReleaseHandlerRef.current = null;
    stopKeepAliveFallback();
  }, [stopKeepAliveFallback]);

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      stopListening();
      releaseMicResources();
      releaseWakeLock();
      muteAudio();
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    if (conversationActive) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [conversationActive, acquireWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && conversationActiveRef.current) {
        acquireWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [acquireWakeLock]);

  const detectSideFromText = (text: string): "you" | "them" => {
    const yourCode = yourLangRef.current;
    const theirCode = theirLangRef.current;
    const yourScore = languageScoreFromText(text, yourCode);
    const theirScore = languageScoreFromText(text, theirCode);

    if (yourScore > theirScore + 1) return "you";
    if (theirScore > yourScore + 1) return "them";

    if (lastDetectedSideRef.current === "you") return "them";
    if (lastDetectedSideRef.current === "them") return "you";
    return "you";
  };

  const normalizeLangValue = (value: string): string => {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  };

  const languageMatches = (detectedLanguage: string, configuredCode: string): boolean => {
    const detected = normalizeLangValue(detectedLanguage);
    if (!detected) return false;
    const code = normalizeLangValue(configuredCode);
    const baseCode = code.split("-")[0];

    if (detected === code || detected === baseCode || detected.startsWith(`${baseCode}-`)) return true;
    if (code.startsWith(`${detected}-`) || baseCode === detected.split("-")[0]) return true;

    const label = normalizeLangValue(LANGUAGES.find((l) => l.code === configuredCode)?.label || "");
    if (label && (detected.includes(label) || label.includes(detected))) return true;

    const aliases = LANGUAGE_ALIASES[baseCode] || [];
    return aliases.some((alias) => detected === alias || detected.includes(alias) || alias.includes(detected));
  };

  const detectSideFromLanguage = (detectedLanguage: string): "you" | "them" | null => {
    if (languageMatches(detectedLanguage, yourLangRef.current)) return "you";
    if (languageMatches(detectedLanguage, theirLangRef.current)) return "them";
    return null;
  };

  const getUnexpectedLanguageMessage = (detectedLanguage?: string): string => {
    const langA = getLabelForCode(yourLangRef.current);
    const langB = getLabelForCode(theirLangRef.current);
    const detected = detectedLanguage ? ` (${detectedLanguage})` : "";
    if (String(uiLanguage).toLowerCase().startsWith("it")) {
      return `Lingua non prevista${detected}. Parla solo in ${langA} o ${langB}.`;
    }
    return `Unexpected language${detected}. Please speak only ${langA} or ${langB}.`;
  };

  // ─── Silence detection ────────────────────────────────────────────────

  const startSilenceDetection = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.fftSize);
    const floatData = new Float32Array(analyser.fftSize);
    let silenceStart: number | null = null;
    let allZeroCount = 0;
    const startTime = Date.now();
    let speechFrames = 0;
    let hasSpeechStarted = false;
    let speechStartTime: number | null = null;
    let lastSpeechTime: number | null = null;
    // Pitch-based gender detection
    const pitchSamples: number[] = [];
    const sampleRate = audioCtxRef.current?.sampleRate || 44100;

    const check = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setLiveLevel(rms);

      if (rms > peakLevelRef.current) peakLevelRef.current = rms;
      rmsAccRef.current.sum += rms;
      rmsAccRef.current.count += 1;

      // Voice activity gate
      if (rms >= VOICE_ACTIVITY_THRESHOLD) {
        speechFrames += 1;
        lastSpeechTime = Date.now();
        if (speechFrames >= VOICE_ACTIVITY_FRAMES) {
          if (!hasSpeechStarted) {
            hasSpeechStarted = true;
            speechStartTime = Date.now();
          }
          // Pitch detection via autocorrelation (sample every ~10 frames to save CPU)
          if (pitchSamples.length < 60 && speechFrames % 10 === 0) {
            analyser.getFloatTimeDomainData(floatData);
            const pitch = detectPitch(floatData, sampleRate);
            if (pitch > 0) pitchSamples.push(pitch);
          }
        }
      } else {
        speechFrames = 0;
      }

      // iOS fallback
      if (rms < 0.001) {
        allZeroCount++;
        if (allZeroCount > 500 && (Date.now() - startTime) > 15000) {
          if (CONVERSATION_DEBUG) console.log("[Conversation] analyser stuck at zero — iOS fallback, stopping");
          peakLevelRef.current = 1;
          stopListening();
          return;
        }
      } else {
        allZeroCount = 0;
      }

      if (hasSpeechStarted && speechStartTime) {
        if (rms < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          else {
            const silenceDuration = (Date.now() - silenceStart) / 1000;
            const speechDuration = ((lastSpeechTime || Date.now()) - speechStartTime) / 1000;

            // Adaptive timeout: longer speech gets more patience for pauses
            const timeout = speechDuration < 3
              ? SILENCE_TIMEOUT_SHORT   // short reply → 1.8s
              : speechDuration < 8
                ? SILENCE_TIMEOUT_NORMAL // normal sentence → 2.8s
                : SILENCE_TIMEOUT_LONG;  // long speech → 3.8s

            if (silenceDuration > timeout) {
              if (CONVERSATION_DEBUG) console.log("[Conversation] silence stop", { silenceDuration: silenceDuration.toFixed(1), speechDuration: speechDuration.toFixed(1), timeout });
              detectedGenderRef.current = classifyGender(pitchSamples);
              if (CONVERSATION_DEBUG) console.log("[Conversation] detected gender:", detectedGenderRef.current, "from", pitchSamples.length, "samples");
              playCutoffChime();
              stopListening();
              return;
            }
          }
        } else {
          silenceStart = null;
        }
      } else if ((Date.now() - startTime) > NO_SPEECH_TIMEOUT_MS) {
        detectedGenderRef.current = classifyGender(pitchSamples);
        noSpeechCaptureRef.current = true;
        stopListening();
        return;
      }

      animFrameRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);

  const releaseMicResources = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    setLiveLevel(0);
  }, []);

  const scheduleListeningRestart = useCallback(() => {
    if (!conversationActiveRef.current) {
      setChatState("idle");
      return;
    }
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      startListening();
    }, 260);
  }, []);

  const ensureMicReady = useCallback(async () => {
    const hasLiveStream = streamRef.current?.getTracks().some((track) => track.readyState === "live");
    if (hasLiveStream && analyserRef.current && audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      return {
        stream: streamRef.current!,
        analyser: analyserRef.current,
      };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Chrome/Edge: request higher quality capture
        ...(typeof window !== "undefined" && { sampleRate: 16000, channelCount: 1 } as any),
      },
    });
    streamRef.current = stream;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);

    // ── Audio processing chain (like AirPods noise processing) ──
    // 1. Input gain — boost quiet mic input
    const inputGain = audioCtx.createGain();
    inputGain.gain.value = 1.8; // +5dB boost for quiet/distant voices

    // 2. Compressor — normalize levels: boost quiet speech, tame loud peaks
    //    Similar to what AirPods/hearing aids do: makes everything more even
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -35;  // start compressing at -35dB (catches quiet speech)
    compressor.knee.value = 12;        // soft knee for natural sound
    compressor.ratio.value = 4;        // 4:1 compression (moderate, not squashed)
    compressor.attack.value = 0.003;   // fast attack — catch transients quickly
    compressor.release.value = 0.15;   // moderate release — smooth recovery

    // 3. Makeup gain — compensate for compression
    const makeupGain = audioCtx.createGain();
    makeupGain.gain.value = 1.5; // boost back after compression

    // 4. High-pass filter — remove low rumble/wind noise (below 85Hz)
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 85;
    highpass.Q.value = 0.7;

    // 5. Analyser — for silence detection / visual level
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    // Chain: mic → inputGain → highpass → compressor → makeupGain → analyser
    source.connect(inputGain);
    inputGain.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(analyser);

    analyserRef.current = analyser;

    return { stream, analyser };
  }, []);

  // ─── Start listening ──────────────────────────────────────────────────

  /** Pick a supported MIME type for MediaRecorder (iOS Safari doesn't support webm) */
  const getRecorderMimeType = (): string => {
    if (typeof MediaRecorder === "undefined") return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
    if (MediaRecorder.isTypeSupported("audio/aac")) return "audio/aac";
    if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
    return ""; // let browser pick default
  };

  async function processRecordedChunk(blob: Blob, recordDuration: number, peakLevel: number) {
    setChatState("transcribing");
    try {
      const { text, language: detectedLang } = await transcribeAudioDetectLang(blob, [
        yourLangRef.current,
        theirLangRef.current,
      ]);
      if (CONVERSATION_DEBUG) console.log("[Conversation] detected:", { text: text.substring(0, 50), language: detectedLang, blobSize: blob.size, blobType: blob.type });

      // Filter out empty, too-short, or Whisper hallucination artifacts
      const trimmed = text.trim();
      const lower = trimmed.toLowerCase();
      const cleanedLower = lower.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
      const isWeakCapture = recordDuration < 900 || peakLevel < 0.05;
      const isSilenceToken =
        /^(you|uh|um|hmm+|mm+|eh+|ah+|ok+|okay)$/.test(cleanedLower);
      const isLikelyGhostPronoun =
        /^(you|tu|du|voi|sie|te)$/.test(cleanedLower) && recordDuration < 1600;
      const isPromptLeak = isLikelyPromptLeakTranscript(trimmed);
      const isHallucination =
        !trimmed ||
        trimmed.length < 2 ||
        /^[\s.,!?…\-—–]+$/.test(trimmed) ||
        // Whisper common hallucinations
        /^(music|applause|laughter|silence|background|thank you|thanks for watching)/i.test(trimmed) ||
        /^\[.*\]$/.test(trimmed) ||
        /^\(.*\)$/.test(trimmed) ||
        // Subtitle/watermark hallucinations
        /sottotitoli|subtitles|subs by|sub(scribe|bed)|www\.|\.com|\.co\.|\.uk|\.org|\.net/i.test(trimmed) ||
        // Repetitive single-word hallucinations (e.g. "you you you" or "...")
        /^(.{1,4})\1{2,}$/i.test(trimmed.replace(/\s+/g, "")) ||
        // Common Whisper noise artifacts in various languages
        lower.includes("amara.org") ||
        lower.includes("zeoranger") ||
        lower.includes("copyright") ||
        lower.includes("♪") ||
        lower.includes("🎵") ||
        // TV/News/broadcast artifacts
        /\bnews\b/i.test(trimmed) ||
        /\b(mbc|cnn|bbc|fox|nbc|abc|cbs|sky|rai|tg[1-5])\b/i.test(trimmed) ||
        /\b(reporter|anchor|correspondent|breaking|headline)\b/i.test(trimmed) ||
        (isWeakCapture && isSilenceToken) ||
        isLikelyGhostPronoun ||
        isPromptLeak;

      if (isHallucination || !conversationActiveRef.current) {
        if (CONVERSATION_DEBUG) console.log("[Conversation] filtered hallucination:", trimmed.substring(0, 40));
        return;
      }

      // Deduplicate: reject if too similar to any of the last 5 messages
      const recentMessages = messagesRef.current.slice(-5);
      const isDuplicate = recentMessages.some((m) => {
        const sim = textSimilarity(lower, m.originalText.toLowerCase());
        return sim > MAX_DUPLICATE_SIMILARITY;
      });
      if (isDuplicate) {
        if (CONVERSATION_DEBUG) console.log("[Conversation] rejected duplicate:", trimmed.substring(0, 40));
        return;
      }

      // Language-based side detection + text analysis for mixed-language utterances
      const sideFromLanguage = detectSideFromLanguage(detectedLang || "");
      const wordCount = cleanedLower ? cleanedLower.split(/\s+/).filter(Boolean).length : 0;
      const yourScore = languageScoreFromText(trimmed, yourLangRef.current);
      const theirScore = languageScoreFromText(trimmed, theirLangRef.current);
      const shortUtterance = wordCount <= 2;
      const hasTextLanguageSignal = Math.max(yourScore, theirScore) >= 1;
      const normalizedDetected = normalizeLangValue(detectedLang || "");
      const hasExplicitForeignDetection =
        !!normalizedDetected &&
        !["unknown", "und", "auto"].includes(normalizedDetected) &&
        sideFromLanguage === null;

      if (hasExplicitForeignDetection && !shortUtterance) {
        setError(getUnexpectedLanguageMessage(detectedLang));
        return;
      }

      if (!sideFromLanguage && !shortUtterance && !hasTextLanguageSignal) {
        setError(getUnexpectedLanguageMessage(detectedLang || ""));
        return;
      }

      // Mixed-language detection: if text has words in BOTH languages,
      // prefer text-based scoring over Whisper's language detection.
      // e.g. "I'm an English boy! Sono grande!" — Whisper may detect "it"
      // but the text is predominantly English, so side should be "you" (en).
      const isMixedLanguage = yourScore >= 1 && theirScore >= 1;
      const sideFromText = detectSideFromText(trimmed);
      const side = isMixedLanguage
        ? sideFromText  // text scoring is more reliable for mixed utterances
        : (sideFromLanguage || sideFromText);
      lastDetectedSideRef.current = side;
      if (CONVERSATION_DEBUG) console.log("[Conversation] side:", side, "lang:", detectedLang, "yourLang:", yourLangRef.current, "theirLang:", theirLangRef.current);

      await processMessage(side, text.trim());
    } catch (e: any) {
      const { key, fallback } = getApiErrorMessage(e);
      setError((t as any)[key] || fallback);
    } finally {
      processingRef.current = false;
      if (conversationActiveRef.current) {
        scheduleListeningRestart();
      } else {
        setChatState("idle");
      }
    }
  }

  const startListening = useCallback(async () => {
    if (!conversationActiveRef.current || processingRef.current || mediaRecorderRef.current?.state === "recording") return;
    if (CONVERSATION_DEBUG) console.log("[Conversation] startListening");
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    suspendAudioForMic();
    setChatState("listening");
    setLiveLevel(0);
    peakLevelRef.current = 0;
    rmsAccRef.current = { sum: 0, count: 0 };
    noSpeechCaptureRef.current = false;

    try {
      const { stream, analyser } = await ensureMicReady();

      const mimeType = getRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const recorderChunks: Blob[] = [];
      const recordStartTime = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recorderChunks.push(e.data);
      };

      recorder.onstop = async () => {
        mediaRecorderRef.current = null;
        setLiveLevel(0);

        const recordDuration = Date.now() - recordStartTime;
        const blobType = recorder.mimeType || "audio/webm";
        const blob = new Blob(recorderChunks, { type: blobType });

        const peakLevel = peakLevelRef.current;

        if (noSpeechCaptureRef.current) {
          noSpeechCaptureRef.current = false;
          scheduleListeningRestart();
          return;
        }

        // Skip only truly empty / accidental taps. Final rejection should happen after transcription.
        if (blob.size < MIN_AUDIO_BLOB_BYTES || recordDuration < 250) {
          scheduleListeningRestart();
          return;
        }

        const trialQuota = await consumeTrialQuota("conversation_ms", recordDuration);
        if (!trialQuota.allowed) {
          setError(getTrialUpgradeMessage(uiLanguage, "conversation"));
          setShowTrialUpgradeModal(true);
          processingRef.current = false;
          conversationActiveRef.current = false;
          setConversationActive(false);
          setChatState("listening");
          releaseMicResources();
          releaseWakeLock();
          return;
        }
        // Compute average RMS across the recording
        const avgRms = rmsAccRef.current.count > 0
          ? rmsAccRef.current.sum / rmsAccRef.current.count
          : 0;

        // Reject distant/background audio (TV, YouTube, speakers nearby)
        // Direct speech into phone mic: avgRms typically 0.06-0.30
        // Background TV/speakers: avgRms typically 0.01-0.03
        if (avgRms < MIN_AVG_RMS_THRESHOLD) {
          if (CONVERSATION_DEBUG) console.log("[Conversation] rejected: avg RMS too low (distant audio)", {
            avgRms: avgRms.toFixed(4),
            peakLevel: peakLevel.toFixed(3),
          });
          scheduleListeningRestart();
          return;
        }
        if (peakLevel < WEAK_PEAK_THRESHOLD) {
          if (CONVERSATION_DEBUG) console.log("[Conversation] rejected: peak too quiet", {
            peakLevel: peakLevel.toFixed(3),
            avgRms: avgRms.toFixed(4),
          });
          scheduleListeningRestart();
          return;
        }
        if (recordDuration < MIN_SPEECH_DURATION_MS && peakLevel < SPEECH_PEAK_THRESHOLD) {
          if (CONVERSATION_DEBUG) console.log("[Conversation] rejected: short + weak capture", {
            blobSize: blob.size,
            recordDuration,
            peakLevel: peakLevel.toFixed(3),
          });
          scheduleListeningRestart();
          return;
        }

        processingRef.current = true;
        await processRecordedChunk(blob, recordDuration, peakLevel);
      };

      // No timeslice — ondataavailable fires once on stop() with complete audio.
      // Using timeslice caused overlapping chunks on Android = duplicate audio.
      recorder.start();
      mediaRecorderRef.current = recorder;
      startSilenceDetection(analyser);

      // Safety net: max recording duration 30s (in case silence detection fails on iOS)
      setTimeout(() => {
        if (mediaRecorderRef.current === recorder && recorder.state === "recording") {
          if (CONVERSATION_DEBUG) console.log("[Conversation] max recording timeout — stopping");
          peakLevelRef.current = Math.max(peakLevelRef.current, 0.11); // bypass peak filter
          playCutoffChime();
          stopListening();
        }
      }, 30000);
    } catch (e) {
      console.error("Mic access failed:", e);
      setChatState("idle");
      releaseMicResources();
      // Fall back to text input
      setShowTextInput(true);
    }
  }, [ensureMicReady, releaseMicResources, scheduleListeningRestart, startSilenceDetection]);

  // ─── Stop listening ───────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    if (CONVERSATION_DEBUG) console.log("[Conversation] stopListening");
    cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setLiveLevel(0);
  }, []);

  // ─── Process a message (translate + speak + continue) ─────────────────

  const processMessage = async (side: "you" | "them", text: string) => {
    const sourceLang = side === "you" ? yourLangRef.current : theirLangRef.current;
    const targetLang = side === "you" ? theirLangRef.current : yourLangRef.current;

    msgIdRef.current += 1;
    const newId = msgIdRef.current;

    setMessages((prev) => [
      ...prev,
      { id: newId, side, originalText: text, translatedText: "...", sourceLang, status: "sent", gender: detectedGenderRef.current || userGender },
    ]);

    setChatState("translating");
    setError(null);

    try {
      const translations = await translateText(text, sourceLang, [targetLang], {
        mode: "live",
      });
      const translatedText = translations[targetLang] || "...";

      setMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, translatedText, status: "translated" } : m))
      );

      // Auto-speak translation — wait for TTS to finish before listening again
      if (autoSpeakRef.current && translatedText !== "...") {
        if (CONVERSATION_DEBUG) console.log("[Conversation] play translated TTS", { targetLang, translatedText: translatedText.slice(0, 60) });
        setChatState("speaking");
        setPlayingId(newId);
        setMessages((prev) =>
          prev.map((m) => (m.id === newId ? { ...m, status: "playing" } : m))
        );

        try {
          // Voice matches the detected speaker's gender (pitch analysis), fallback to user profile
          const speakerGender = detectedGenderRef.current || userGender;
          await withTimeout(
            playTTS(translatedText, undefined, undefined, targetLang, speakerGender),
            TTS_PLAYBACK_TIMEOUT_MS,
            "playTTS",
          );
        } catch (e) {
          console.error("TTS failed:", e);
        } finally {
          setPlayingId(null);
          setMessages((prev) =>
            prev.map((m) => (m.id === newId ? { ...m, status: "done" } : m))
          );
        }
      }

      // Mark as done (no auto-speak path)
      setMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, status: "done" } : m))
      );
    } catch (e: any) {
      const { key, fallback } = getApiErrorMessage(e);
      setError((t as any)[key] || fallback);
      // Fallback visible output: keep conversation flowing even if translation API fails.
      setMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, translatedText: text, status: "done" } : m))
      );
    }

  };

  // ─── Start / Stop conversation ────────────────────────────────────────

  const startConversation = () => {
    prepareAudioForSafari();
    setConversationActive(true);
    conversationActiveRef.current = true;
    acquireWakeLock();
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setMessages([]);
    setError(null);
    processingRef.current = false;
    startListening();
  };

  const stopConversation = () => {
    setConversationActive(false);
    conversationActiveRef.current = false;
    processingRef.current = false;
    releaseWakeLock();
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    stopListening();
    releaseMicResources();
    setChatState("idle");
  };

  // ─── Swap languages ──────────────────────────────────────────────────

  const swapLanguages = () => {
    setYourLang(theirLang);
    setTheirLang(yourLang);
  };

  // ─── Text input fallback ─────────────────────────────────────────────

  const handleTextSubmit = async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");

    const side = textInputSide;
    processingRef.current = true;
    prepareAudioForSafari();
    try {
      await processMessage(side, text);
    } finally {
      processingRef.current = false;
      if (conversationActiveRef.current) {
        scheduleListeningRestart();
      }
    }
  };

  const handleSpeak = async (text: string, id: number, langCode: string, side: "you" | "them", msgGender?: "male" | "female" | "") => {
    if (playingId !== null) return;
    // Pause mic so playback doesn't get re-captured
    const wasListening = chatState === "listening";
    if (wasListening) stopListening();
    prepareAudioForSafari();
    setPlayingId(id);
    setChatState("speaking");
    try {
      const speakerGender = msgGender || userGender;
      await withTimeout(
        playTTS(text, undefined, undefined, langCode, speakerGender),
        TTS_PLAYBACK_TIMEOUT_MS,
        "playTTS",
      );
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlayingId(null);
      if (conversationActiveRef.current) {
        scheduleListeningRestart();
      } else {
        setChatState("idle");
      }
    }
  };


  const isListening = chatState === "listening";
  const busy = chatState === "translating" || chatState === "speaking" || chatState === "transcribing";

  const handleShareConversation = async () => {
    const yourLabel = LANGUAGES.find((l) => l.code === yourLang)?.label || yourLang;
    const theirLabel = LANGUAGES.find((l) => l.code === theirLang)?.label || theirLang;
    const text = messages.map((msg) =>
      `[${msg.side === "you" ? t("you") : t("them")}] ${msg.originalText}\n→ ${msg.translatedText}`
    ).join("\n\n");
    const shareText = `${t("conversation")} (${yourLabel} ↔ ${theirLabel})\n\n${text}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "PolyGlot AI", text: shareText });
      } catch (e: any) {
        if (e.name !== "AbortError") {
          await navigator.clipboard.writeText(shareText);
        }
      }
    } else {
      await navigator.clipboard.writeText(shareText);
    }
  };

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => { stopConversation(); navigate("/"); }} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <MessagesSquare className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("conversation")}</h1>
      </header>
      <div className="flex items-center gap-2 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]/50 shrink-0">
        <select
          value={yourLang}
          onChange={(e) => setYourLang(e.target.value)}
          disabled={conversationActive}
          className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60 truncate"
        >
          <LanguageOptions />
        </select>
        <button
          onClick={swapLanguages}
          disabled={conversationActive}
          className="p-2 bg-[#123182] rounded-xl text-[#F4F4F4]/60 hover:bg-[#295BDB] hover:text-[#F4F4F4] transition-colors shrink-0 disabled:opacity-40"
        >
          <ArrowRightLeft className="w-4 h-4" />
        </button>
        <select
          value={theirLang}
          onChange={(e) => setTheirLang(e.target.value)}
          disabled={conversationActive}
          className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60 truncate"
        >
          <LanguageOptions />
        </select>
      </div>
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3 shrink-0">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        <div className="absolute top-3 right-4 z-10">
          <button
            onClick={handleShareConversation}
            disabled={messages.length === 0}
            className="p-2.5 rounded-xl border border-[#FFFFFF26] bg-[#0E2666]/90 backdrop-blur-sm transition-colors text-[#F4F4F4]/70 hover:text-[#F4F4F4] hover:bg-[#123182] disabled:opacity-20"
          >
            <Upload className="w-5 h-5" />
          </button>
        </div>

      <div className="h-full overflow-y-auto p-4 pt-14 flex flex-col gap-4 min-h-0">
        {messages.length === 0 && !conversationActive && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/60 text-sm text-center px-8">{t("conversationAutoDetect")}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1 ${msg.side === "you" ? "items-start" : "items-end"}`}
          >
            <span className="text-xs text-[#F4F4F4]/60 px-1">
              {msg.side === "you" ? t("you") : t("them")} · {getLabelForCode(msg.sourceLang)}
            </span>
            <div
              className={`p-4 rounded-2xl max-w-[85%] ${
                msg.side === "you" ? "bg-[#295BDB] rounded-bl-sm" : "bg-[#123182] rounded-br-sm"
              }`}
            >
              <p className="text-lg font-medium">{msg.translatedText}</p>
              <div className="flex items-end justify-between gap-2 mt-1">
                <p className="text-sm opacity-60">{msg.originalText}</p>
                {/* WhatsApp-style checkmarks */}
                <span className="shrink-0">
                  {msg.status === "sent" && (
                    <Check className="w-4 h-4 text-[#F4F4F4]/60" />
                  )}
                  {msg.status === "translated" && (
                    <CheckCheck className="w-4 h-4 text-[#F4F4F4]/60" />
                  )}
                  {msg.status === "playing" && (
                    <CheckCheck className="w-4 h-4 text-[#5BF0F0]" />
                  )}
                  {msg.status === "done" && (
                    <CheckCheck className="w-4 h-4 text-[#5BF0F0]" />
                  )}
                </span>
              </div>
            </div>
            <button
              onClick={() => handleSpeak(msg.translatedText, msg.id, msg.side === "you" ? theirLang : yourLang, msg.side, msg.gender)}
              disabled={playingId !== null}
              className={`px-2 py-1 rounded-lg transition-colors ${
                playingId === msg.id ? "text-[#295BDB] animate-pulse" : "text-[#F4F4F4]/60 hover:text-[#F4F4F4]/80"
              }`}
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* Listening indicator */}
        {(chatState === "listening" || chatState === "transcribing") && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className={`w-3 h-3 rounded-full animate-pulse ${chatState === "listening" ? "bg-red-500" : "bg-amber-500"}`} />
            <span className="text-sm text-[#F4F4F4]/60">
              {chatState === "listening" ? t("listeningBoth") : t("learnTranscribing")}
            </span>
          </div>
        )}

        {chatState === "speaking" && (
          <div className="text-[#295BDB] animate-pulse text-sm text-center flex items-center justify-center gap-2">
            <Volume2 className="w-4 h-4" />
            {t("speaking")}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      </div>

      {/* Text input fallback */}
      {showTextInput && (
        <div className="border-t border-[#FFFFFF14] bg-[#0E2666] px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setTextInputSide("you")}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                textInputSide === "you" ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#123182] text-[#F4F4F4]/60"
              }`}
            >
              {t("you")}
            </button>
            <button
              onClick={() => setTextInputSide("them")}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                textInputSide === "them" ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#123182] text-[#F4F4F4]/60"
              }`}
            >
              {t("them")}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
              placeholder={t("typeMessage")}
              className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-2.5 text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] text-sm"
              autoFocus
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim()}
              className="p-2.5 rounded-xl bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
            <button onClick={() => setShowTextInput(false)} className="text-xs text-[#F4F4F4]/60 hover:text-[#F4F4F4]">✕</button>
          </div>
        </div>
      )}

      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] shrink-0 pb-[env(safe-area-inset-bottom)]">
        {/* Mic button + keyboard toggle */}
        <div className="flex items-center justify-center gap-4 py-4">
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className="p-3 rounded-xl bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB] transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>

          <button
            onClick={conversationActive ? stopConversation : startConversation}
            disabled={busy && !conversationActive}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl select-none ${
              conversationActive
                ? "bg-red-500 ring-4 ring-red-500/30 scale-105"
                : "bg-[#295BDB] ring-4 ring-[#295BDB]/20 hover:scale-105"
            } ${isListening ? "animate-pulse" : ""}`}
          >
            {conversationActive ? (
              <MicOff className="w-8 h-8" />
            ) : (
              <Mic className="w-8 h-8" />
            )}
          </button>

          <button
            onClick={() => {
              const newVal = !autoSpeak;
              setAutoSpeak(newVal);
              if (!newVal) muteAudio();
              else prepareAudioForSafari();
            }}
            className={`p-3 rounded-xl transition-colors ${
              autoSpeak ? "bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB]" : "bg-red-500/20 text-red-400"
            }`}
          >
            {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
        </div>

        <p className="text-xs text-[#F4F4F4]/60 text-center pb-3">
          {conversationActive ? t("stopConversation") : t("startConversation")}
        </p>
      </div>

      {showTrialUpgradeModal && (
        <div className="fixed inset-0 z-[80] bg-[#02114A]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#FFFFFF1F] bg-[#0E2666] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-[#F4F4F4]">
              {isIt ? "Tempo conversazione esaurito" : "Conversation time exhausted"}
            </h3>
            <p className="mt-2 text-sm text-[#F4F4F4]/70">
              {getTrialUpgradeMessage(uiLanguage, "conversation")}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowTrialUpgradeModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#1A3A93] transition-colors"
              >
                {isIt ? "Chiudi" : "Close"}
              </button>
              <button
                onClick={() => {
                  setShowTrialUpgradeModal(false);
                  navigate("/plans");
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#295BDB] text-[#F4F4F4] font-semibold hover:bg-[#3A6AE3] transition-colors"
              >
                {isIt ? "Vai ai piani" : "View plans"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
