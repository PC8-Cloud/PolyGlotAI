import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, MicOff, Send, Volume2, VolumeX, ArrowRightLeft, Check, CheckCheck, Upload, MessagesSquare } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLabelForCode } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { translateText, playTTS, prepareAudioForSafari, muteAudio, getApiErrorMessage, transcribeAudioDetectLang } from "../lib/openai";

type MsgStatus = "sent" | "translated" | "playing" | "done";

interface Message {
  id: number;
  side: "you" | "them";
  originalText: string;
  translatedText: string;
  sourceLang: string;
  status: MsgStatus;
}

// Silence detection
const SILENCE_TIMEOUT = 1.2; // seconds of silence before auto-stop
const SILENCE_THRESHOLD = 0.08; // raised to ignore background noise (music, TV)
const MIN_SPEECH_DURATION_MS = 1200; // ignore recordings shorter than this
const SPEECH_PEAK_THRESHOLD = 0.10; // minimum peak audio level during recording to consider it real speech (not distant TV)
const MAX_DUPLICATE_SIMILARITY = 0.8; // reject if >80% similar to a recent message

/** Simple text similarity (0-1) based on common words */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  wordsA.forEach((w) => { if (wordsB.has(w)) common++; });
  return common / Math.max(wordsA.size, wordsB.size);
}

/** Clean Whisper transcription: remove repeated words/phrases that Whisper hallucinates */
function cleanTranscription(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) return "";

  // 1. Remove consecutive duplicate words: "ciao ciao ciao" → "ciao"
  const words = cleaned.split(/\s+/);
  const deduped: string[] = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
      deduped.push(words[i]);
    }
  }
  cleaned = deduped.join(" ");

  // 2. Remove repeated 2-3 word phrases: "thank you thank you thank you" → "thank you"
  for (let phraseLen = 2; phraseLen <= 3; phraseLen++) {
    const w = cleaned.split(/\s+/);
    if (w.length < phraseLen * 2) continue;
    const phrase = w.slice(0, phraseLen).join(" ").toLowerCase();
    const rest = w.slice(phraseLen).join(" ").toLowerCase();
    // Check if the rest is just repetitions of the phrase
    const stripped = rest.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
    if (stripped.length < rest.length * 0.3) {
      cleaned = w.slice(0, phraseLen).join(" ");
    }
  }

  // 3. Detect substring repetitions: "bonjournobonjournobonjourno" → "bonjourno"
  for (let patLen = 3; patLen <= Math.min(20, Math.floor(cleaned.length / 2)); patLen++) {
    const pattern = cleaned.substring(0, patLen).toLowerCase();
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = cleaned.match(regex);
    if (matches && matches.length >= 3 && (matches.length * patLen) > cleaned.length * 0.5) {
      cleaned = cleaned.substring(0, patLen);
      break;
    }
  }

  return cleaned.trim();
}

export default function Conversation() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

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
  const [liveLevel, setLiveLevel] = useState(0); // mic audio level for visual feedback

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const conversationActiveRef = useRef(false);
  const processingRef = useRef(false);
  const yourLangRef = useRef(yourLang);
  const theirLangRef = useRef(theirLang);
  const autoSpeakRef = useRef(autoSpeak);

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peakLevelRef = useRef(0); // track peak audio level during recording

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatState]);

  useEffect(() => { yourLangRef.current = yourLang; }, [yourLang]);
  useEffect(() => { theirLangRef.current = theirLang; }, [theirLang]);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => { conversationActiveRef.current = conversationActive; }, [conversationActive]);

  useEffect(() => {
    return () => { stopListening(); muteAudio(); };
  }, []);

  // ─── Language matching ──────────────────────────────────────────────────

  /** Map Whisper detected language code to "you" or "them", or null if unrecognized language */
  const detectSide = (detectedLang: string): "you" | "them" | null => {
    const dl = detectedLang.toLowerCase().trim();
    const yourCode = yourLangRef.current.toLowerCase();
    const theirCode = theirLangRef.current.toLowerCase();

    // Direct match
    if (dl === yourCode || dl.startsWith(yourCode) || yourCode.startsWith(dl)) return "you";
    if (dl === theirCode || dl.startsWith(theirCode) || theirCode.startsWith(dl)) return "them";

    // Whisper returns full language names sometimes (e.g., "english", "italian")
    const yourLabel = (LANGUAGES.find((l) => l.code === yourLangRef.current)?.label || "").toLowerCase();
    const theirLabel = (LANGUAGES.find((l) => l.code === theirLangRef.current)?.label || "").toLowerCase();
    if (dl.includes(yourLabel) || yourLabel.includes(dl)) return "you";
    if (dl.includes(theirLabel) || theirLabel.includes(dl)) return "them";

    // Unrecognized language (e.g. Korean when configured IT/EN) — reject
    return null;
  };

  // ─── Silence detection ────────────────────────────────────────────────

  const startSilenceDetection = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;
    let allZeroCount = 0; // detect if analyser returns no data (iOS AudioContext issue)
    const startTime = Date.now();

    const check = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setLiveLevel(rms);

      // Track peak level to distinguish real speech from distant TV
      if (rms > peakLevelRef.current) peakLevelRef.current = rms;

      // iOS fallback: if analyser reads near-zero for 15+ seconds, stop and let
      // onstop handle the recording (the audio data may still be valid even if
      // AudioContext analyser doesn't work properly on iOS)
      if (rms < 0.001) {
        allZeroCount++;
        if (allZeroCount > 500 && (Date.now() - startTime) > 15000) {
          console.log("[Conversation] analyser stuck at zero — iOS fallback, stopping");
          peakLevelRef.current = 1; // bypass peak check since analyser is broken
          stopListening();
          return;
        }
      } else {
        allZeroCount = 0;
      }

      if (rms < SILENCE_THRESHOLD) {
        if (!silenceStart) silenceStart = Date.now();
        else if ((Date.now() - silenceStart) / 1000 > SILENCE_TIMEOUT) {
          stopListening();
          return;
        }
      } else {
        silenceStart = null;
      }

      animFrameRef.current = requestAnimationFrame(check);
    };
    check();
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

  const startListening = useCallback(async () => {
    if (!conversationActiveRef.current || processingRef.current) return;
    setChatState("listening");
    setLiveLevel(0);
    peakLevelRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // iOS Safari keeps AudioContext suspended until explicitly resumed
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = getRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      const recordStartTime = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current);
        audioCtx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        audioCtxRef.current = null;
        setLiveLevel(0);

        const recordDuration = Date.now() - recordStartTime;
        const blobType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });

        const peakLevel = peakLevelRef.current;

        // Skip if too short, too small, or audio peak too low (distant TV, not direct speech)
        if (blob.size < 2000 || recordDuration < MIN_SPEECH_DURATION_MS || peakLevel < SPEECH_PEAK_THRESHOLD) {
          if (peakLevel < SPEECH_PEAK_THRESHOLD && blob.size >= 2000) {
            console.log("[Conversation] skipped: peak audio too low", peakLevel.toFixed(3), "< threshold", SPEECH_PEAK_THRESHOLD);
          }
          if (conversationActiveRef.current && !processingRef.current) {
            startListening();
          } else {
            setChatState("idle");
          }
          return;
        }

        // Transcribe with language detection
        processingRef.current = true;
        setChatState("transcribing");
        try {
          const { text: rawText, language: detectedLang } = await transcribeAudioDetectLang(blob);

          // Clean Whisper repetition artifacts: "ciao ciao ciao" → "ciao"
          const text = cleanTranscription(rawText);
          console.log("[Conversation] detected:", { raw: rawText.substring(0, 40), cleaned: text.substring(0, 40), detectedLang });

          // Filter out empty, too-short, or Whisper hallucination artifacts
          const trimmed = text.trim();
          const lower = trimmed.toLowerCase();
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
            /\b(reporter|anchor|correspondent|breaking|headline)\b/i.test(trimmed);

          if (isHallucination || !conversationActiveRef.current) {
            console.log("[Conversation] filtered hallucination:", trimmed.substring(0, 40));
            processingRef.current = false;
            if (conversationActiveRef.current) startListening();
            else setChatState("idle");
            return;
          }

          // Deduplicate: reject if too similar to any of the last 5 messages
          const recentMessages = messages.slice(-5);
          const isDuplicate = recentMessages.some((m) => {
            const sim = textSimilarity(lower, m.originalText.toLowerCase());
            return sim > MAX_DUPLICATE_SIMILARITY;
          });
          if (isDuplicate) {
            console.log("[Conversation] rejected duplicate:", trimmed.substring(0, 40));
            processingRef.current = false;
            if (conversationActiveRef.current) startListening();
            else setChatState("idle");
            return;
          }

          const side = detectSide(detectedLang);
          console.log("[Conversation] side:", side, "yourLang:", yourLangRef.current, "theirLang:", theirLangRef.current);

          // Reject if detected language doesn't match either configured language
          if (side === null) {
            console.log("[Conversation] rejected: unrecognized language", detectedLang);
            processingRef.current = false;
            if (conversationActiveRef.current) startListening();
            else setChatState("idle");
            return;
          }

          await processMessage(side, text.trim());
        } catch (e: any) {
          const { key, fallback } = getApiErrorMessage(e);
          setError((t as any)[key] || fallback);
          processingRef.current = false;
          if (conversationActiveRef.current) startListening();
          else setChatState("idle");
        }
      };

      recorder.start(500); // timeslice 500ms — iOS Safari needs this to emit ondataavailable
      mediaRecorderRef.current = recorder;
      startSilenceDetection(analyser);

      // Safety net: max recording duration 30s (in case silence detection fails on iOS)
      setTimeout(() => {
        if (mediaRecorderRef.current === recorder && recorder.state === "recording") {
          console.log("[Conversation] max recording timeout — stopping");
          peakLevelRef.current = Math.max(peakLevelRef.current, 0.11); // bypass peak filter
          stopListening();
        }
      }, 30000);
    } catch (e) {
      console.error("Mic access failed:", e);
      setChatState("idle");
      // Fall back to text input
      setShowTextInput(true);
    }
  }, [startSilenceDetection]);

  // ─── Stop listening ───────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
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
      { id: newId, side, originalText: text, translatedText: "...", sourceLang, status: "sent" },
    ]);

    setChatState("translating");
    setError(null);

    try {
      const translations = await translateText(text, sourceLang, [targetLang]);
      const translatedText = translations[targetLang] || "...";

      setMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, translatedText, status: "translated" } : m))
      );

      // Auto-speak translation — wait for TTS to finish before listening again
      if (autoSpeakRef.current && translatedText !== "...") {
        setChatState("speaking");
        setPlayingId(newId);
        setMessages((prev) =>
          prev.map((m) => (m.id === newId ? { ...m, status: "playing" } : m))
        );

        try {
          await playTTS(translatedText, undefined, undefined, targetLang);
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
    }

    processingRef.current = false;

    // Continue listening
    if (conversationActiveRef.current) {
      startListening();
    } else {
      setChatState("idle");
    }
  };

  // ─── Start / Stop conversation ────────────────────────────────────────

  const startConversation = () => {
    prepareAudioForSafari();
    setConversationActive(true);
    conversationActiveRef.current = true;
    setMessages([]);
    setError(null);
    startListening();
  };

  const stopConversation = () => {
    setConversationActive(false);
    conversationActiveRef.current = false;
    processingRef.current = false;
    stopListening();
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
    await processMessage(side, text);
  };

  const handleSpeak = async (text: string, id: number, langCode: string) => {
    if (playingId !== null) return;
    prepareAudioForSafari();
    setPlayingId(id);
    try {
      await playTTS(text, undefined, undefined, langCode);
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlayingId(null);
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
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => { stopConversation(); navigate("/"); }} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <MessagesSquare className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("conversation")}</h1>
        <button
          onClick={handleShareConversation}
          disabled={messages.length === 0}
          className="p-2 rounded-xl transition-colors bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB] disabled:opacity-20"
        >
          <Upload className="w-5 h-5" />
        </button>
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

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
        {messages.length === 0 && !conversationActive && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("conversationAutoDetect")}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1 ${msg.side === "you" ? "items-start" : "items-end"}`}
          >
            <span className="text-xs text-[#F4F4F4]/40 px-1">
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
                    <Check className="w-4 h-4 text-[#F4F4F4]/40" />
                  )}
                  {msg.status === "translated" && (
                    <CheckCheck className="w-4 h-4 text-[#F4F4F4]/40" />
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
              onClick={() => handleSpeak(msg.translatedText, msg.id, msg.side === "you" ? theirLang : yourLang)}
              disabled={playingId !== null}
              className={`px-2 py-1 rounded-lg transition-colors ${
                playingId === msg.id ? "text-[#295BDB] animate-pulse" : "text-[#F4F4F4]/30 hover:text-[#F4F4F4]/80"
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
            <span className="text-sm text-[#F4F4F4]/40">
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

      {/* Text input fallback */}
      {showTextInput && (
        <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-3 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setTextInputSide("you")}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                textInputSide === "you" ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#123182] text-[#F4F4F4]/40"
              }`}
            >
              {t("you")}
            </button>
            <button
              onClick={() => setTextInputSide("them")}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                textInputSide === "them" ? "bg-[#295BDB] text-[#F4F4F4]" : "bg-[#123182] text-[#F4F4F4]/40"
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
            <button onClick={() => setShowTextInput(false)} className="text-xs text-[#F4F4F4]/40 hover:text-[#F4F4F4]">✕</button>
          </div>
        </div>
      )}

      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        {/* Mic button + keyboard toggle */}
        <div className="flex items-center justify-center gap-4 py-4">
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className="p-3 rounded-xl bg-[#123182] text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#295BDB] transition-colors"
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
              autoSpeak ? "bg-[#123182] text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#295BDB]" : "bg-red-500/20 text-red-400"
            }`}
          >
            {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
        </div>

        <p className="text-xs text-[#F4F4F4]/30 text-center pb-3">
          {conversationActive ? t("stopConversation") : t("startConversation")}
        </p>
      </div>
    </div>
  );
}
