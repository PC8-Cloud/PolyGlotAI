import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Volume2, VolumeX, Megaphone, Check } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLocaleForCode } from "../lib/languages";
import { translateText, playTTS, prepareAudioForSafari, getApiErrorMessage } from "../lib/openai";

interface Entry {
  id: number;
  originalText: string;
  translatedText: string;
}

const SHORT_PAUSE_MS = 2000; // translate chunk in background
const LONG_PAUSE_MS = 4500;  // stop and play everything

export default function MegaphonePage() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [speakerLang, setSpeakerLang] = useState(defaultSourceLanguage);
  const [targetLang, setTargetLang] = useState(
    defaultSourceLanguage === "en" ? "it" : "en",
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readyChunks, setReadyChunks] = useState(0);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const isListeningRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const entryIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<any>(null);
  const processingRef = useRef(false);

  // Incremental translation refs
  const segmentsRef = useRef<string[]>([]); // isFinal results
  const translatedCountRef = useRef(0); // how many segments already sent
  const translationPromisesRef = useRef<Promise<string>[]>([]);
  const shortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Wake Lock
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch {}
  };
  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };
  useEffect(() => () => releaseWakeLock(), []);

  // ─── Pause timers ──────────────────────────────────────────────────────────

  const clearPauseTimers = () => {
    if (shortTimerRef.current) { clearTimeout(shortTimerRef.current); shortTimerRef.current = null; }
    if (longTimerRef.current) { clearTimeout(longTimerRef.current); longTimerRef.current = null; }
  };

  const translatePendingSegments = () => {
    const newSegments = segmentsRef.current.slice(translatedCountRef.current);
    if (newSegments.length === 0) return;
    const text = newSegments.join(" ").trim();
    if (!text) return;
    translatedCountRef.current = segmentsRef.current.length;
    const promise = translateText(text, speakerLang, [targetLang])
      .then((r) => r[targetLang] || "...")
      .catch(() => "...");
    translationPromisesRef.current.push(promise);
    // Track ready count
    promise.then(() => setReadyChunks((c) => c + 1));
  };

  const resetPauseTimers = () => {
    clearPauseTimers();

    // Short pause: translate accumulated final text in background
    shortTimerRef.current = setTimeout(() => {
      if (!isListeningRef.current) return;
      translatePendingSegments();
    }, SHORT_PAUSE_MS);

    // Long pause: stop and play everything
    longTimerRef.current = setTimeout(() => {
      if (isListeningRef.current && hasSpokenRef.current && transcriptRef.current.trim()) {
        finishAndPlay();
      }
    }, LONG_PAUSE_MS);
  };

  // ─── Toggle listening ──────────────────────────────────────────────────────

  const toggleListening = () => {
    if (isListening) {
      prepareAudioForSafari();
      finishAndPlay();
      return;
    }
    if (isTranslating || isSpeaking || processingRef.current) return;

    prepareAudioForSafari();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    const locale = getLocaleForCode(speakerLang);
    if (locale) rec.lang = locale;

    rec.onresult = (event: any) => {
      const segments: string[] = [];
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          segments.push(event.results[i][0].transcript);
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      segmentsRef.current = segments;
      const combined = segments.join("") + interimText;
      setTranscript(combined);
      transcriptRef.current = combined;
      if (combined.trim()) {
        hasSpokenRef.current = true;
        resetPauseTimers();
      }
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      clearPauseTimers();
      setIsListening(false);
      releaseWakeLock();
    };

    rec.onend = () => {
      if (isListeningRef.current && transcriptRef.current.trim()) {
        finishAndPlay();
      } else if (isListeningRef.current) {
        clearPauseTimers();
        setIsListening(false);
        setTranscript("");
        releaseWakeLock();
      }
    };

    // Reset state
    recognitionRef.current = rec;
    isListeningRef.current = true;
    setIsListening(true);
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;
    segmentsRef.current = [];
    translatedCountRef.current = 0;
    translationPromisesRef.current = [];
    setReadyChunks(0);
    setError(null);
    acquireWakeLock();

    try {
      rec.start();
    } catch (e) {
      console.warn("Failed to start:", e);
      setIsListening(false);
      releaseWakeLock();
    }
  };

  // ─── Finish and play ───────────────────────────────────────────────────────

  const finishAndPlay = async () => {
    if (processingRef.current) return; // prevent double-fire
    processingRef.current = true;

    clearPauseTimers();

    // Immediately mark as not listening to prevent onend re-entry
    isListeningRef.current = false;
    setIsListening(false);

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    const fullText = transcriptRef.current.trim();
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;

    if (!fullText) {
      releaseWakeLock();
      resetIncrementalState();
      processingRef.current = false;
      return;
    }

    // Translate any remaining final segments not yet sent
    translatePendingSegments();

    // Check for remaining interim text (not finalized by speech recognition)
    const finalJoined = segmentsRef.current.join("");
    const remaining = fullText.substring(finalJoined.length).trim();
    if (remaining) {
      const promise = translateText(remaining, speakerLang, [targetLang])
        .then((r) => r[targetLang] || "...")
        .catch(() => "...");
      translationPromisesRef.current.push(promise);
    }

    // If no chunks at all, translate the whole thing
    if (translationPromisesRef.current.length === 0) {
      const promise = translateText(fullText, speakerLang, [targetLang])
        .then((r) => r[targetLang] || "...")
        .catch(() => "...");
      translationPromisesRef.current.push(promise);
    }

    // Show entry
    entryIdRef.current += 1;
    const entryId = entryIdRef.current;
    setEntries((prev) => [...prev, { id: entryId, originalText: fullText, translatedText: "..." }]);
    setIsSpeaking(true);

    // Play all chunks sequentially — first ones are likely already resolved!
    let fullTranslation = "";
    try {
      for (const promise of translationPromisesRef.current) {
        const translated = await promise;
        fullTranslation += (fullTranslation ? " " : "") + translated;

        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, translatedText: fullTranslation } : e))
        );

        if (autoSpeak && translated !== "...") {
          try {
            await playTTS(translated, undefined, undefined, targetLang);
          } catch (e) {
            console.error("TTS chunk failed:", e);
          }
        }
      }
    } catch (e: any) {
      console.error("Translation failed:", e);
      const { key, fallback } = getApiErrorMessage(e);
      setError((t as any)[key] || fallback);
    }

    setIsSpeaking(false);
    releaseWakeLock();
    resetIncrementalState();
    processingRef.current = false;
  };

  const resetIncrementalState = () => {
    segmentsRef.current = [];
    translatedCountRef.current = 0;
    translationPromisesRef.current = [];
    setReadyChunks(0);
  };

  const speakerLangObj = LANGUAGES.find((l) => l.code === speakerLang);
  const targetLangObj = LANGUAGES.find((l) => l.code === targetLang);
  const busy = isTranslating || isSpeaking;

  const langOptions = LANGUAGES.map((l) => ({
    code: l.code,
    label: `${l.flag} ${l.label}`,
  }));

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate("/group")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Megaphone className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("megaphone")}</h1>
        <button
          onClick={() => setAutoSpeak(!autoSpeak)}
          className={`p-2 rounded-xl transition-colors ${
            autoSpeak ? "bg-[#295BDB]/20 text-[#295BDB]" : "bg-[#123182] text-[#F4F4F4]/40"
          }`}
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      <div className="p-4 flex items-center gap-3 border-b border-[#FFFFFF14] bg-[#0E2666]/50">
        <select
          value={speakerLang}
          onChange={(e) => setSpeakerLang(e.target.value)}
          className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
        >
          {langOptions.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <span className="text-[#F4F4F4]/40 text-lg">→</span>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
        >
          {langOptions.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {entries.length === 0 && !isListening && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Megaphone className="w-16 h-16 text-[#F4F4F4]/10 mx-auto" />
              <p className="text-[#F4F4F4]/30 text-sm px-8">{t("megaphoneDesc")}</p>
            </div>
          </div>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="bg-[#0E2666] rounded-2xl p-5 border border-[#FFFFFF14] space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-xs text-[#F4F4F4]/40 shrink-0 mt-1">{speakerLangObj?.flag}</span>
              <p className="text-sm text-[#F4F4F4]/60">{entry.originalText}</p>
            </div>
            <div className="border-t border-[#FFFFFF14]" />
            <div className="flex items-start gap-2">
              <span className="text-xs text-[#F4F4F4]/40 shrink-0 mt-1">{targetLangObj?.flag}</span>
              <p className="text-lg font-bold text-[#295BDB] flex-1">{entry.translatedText}</p>
            </div>
          </div>
        ))}

        {transcript && isListening && (
          <div className="bg-[#123182]/30 rounded-2xl p-5 border border-[#FFFFFF14]/50 italic">
            <p className="text-lg text-[#F4F4F4]/80">{transcript}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-[#F4F4F4]/40">{t("listening")}</span>
              {readyChunks > 0 && (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> {readyChunks} {readyChunks === 1 ? "chunk" : "chunks"}
                </span>
              )}
            </div>
          </div>
        )}

        {isListening && !transcript && (
          <div className="flex items-center justify-center gap-2 text-[#F4F4F4]/40 text-sm py-4">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            {t("listening")}
          </div>
        )}

        {isSpeaking && (
          <div className="text-[#295BDB] animate-pulse text-sm text-center flex items-center justify-center gap-2">
            <Volume2 className="w-4 h-4" />
            {t("speaking")}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-6 flex flex-col items-center gap-3">
        <button
          onClick={toggleListening}
          disabled={busy}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-2xl disabled:opacity-40 select-none ${
            isListening
              ? "bg-red-500 ring-4 ring-red-500/30 animate-pulse scale-110"
              : "bg-[#295BDB] ring-4 ring-[#295BDB]/20 hover:scale-105"
          }`}
        >
          <Mic className="w-9 h-9" />
        </button>
        <span className="text-xs text-[#F4F4F4]/40">
          {isListening ? t("tapToStop") : t("tapToSpeak")}
        </span>
      </div>
    </div>
  );
}
