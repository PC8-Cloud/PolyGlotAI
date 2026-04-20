import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Volume2, VolumeX, Megaphone, Check, Upload, ClipboardPaste, FolderOpen } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLocaleForCode } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { translateText, playTTS, prepareAudioForSafari, muteAudio, getApiErrorMessage, getRealtimeTranslationConfig, suspendAudioForMic } from "../lib/openai";
import { extractTextFromFile } from "../lib/file-reader";
import { consumeTrialQuota, getTrialUpgradeMessage } from "../lib/trial";

interface Entry {
  id: number;
  originalText: string;
  translatedText: string;
}

const SHORT_PAUSE_MS = 1600; // translate chunk in background, faster feedback
const LONG_PAUSE_MS = 3200;  // stop and play everything sooner
export default function MegaphonePage() {
  const navigate = useNavigate();
  const { uiLanguage, userGender } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [speakerLang, setSpeakerLang] = useState(uiLanguage);
  const [targetLang, setTargetLang] = useState(
    uiLanguage === "en" ? "it" : "en",
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readyChunks, setReadyChunks] = useState(0);
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState("");

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isTranslatingRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const entryIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<any>(null);
  const wakeLockReleaseHandlerRef = useRef<(() => void) | null>(null);
  const keepAliveCtxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);
  const processingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listeningStartedAtRef = useRef<number | null>(null);

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
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { isTranslatingRef.current = isTranslating; }, [isTranslating]);

  // Wake Lock
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
    } catch {}
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
      const shouldKeepAwake =
        isListeningRef.current || isSpeakingRef.current || isTranslatingRef.current || processingRef.current;
      if (!shouldKeepAwake) return;
      if (!("wakeLock" in navigator)) {
        await startKeepAliveFallback();
        return;
      }
      if (wakeLockRef.current) return;
      const lock = await (navigator as any).wakeLock.request("screen");
      const handleRelease = () => {
        wakeLockRef.current = null;
        if (document.visibilityState === "visible") {
          void acquireWakeLock();
        } else {
          void startKeepAliveFallback();
        }
      };
      lock.addEventListener?.("release", handleRelease);
      wakeLockReleaseHandlerRef.current = handleRelease;
      wakeLockRef.current = lock;
      stopKeepAliveFallback();
    } catch {
      await startKeepAliveFallback();
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

  useEffect(() => () => { releaseWakeLock(); muteAudio(); }, [releaseWakeLock]);

  useEffect(() => {
    if (isListening || isSpeaking || isTranslating || processingRef.current) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isListening, isSpeaking, isTranslating, acquireWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && (isListeningRef.current || isSpeaking || isTranslating)) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isSpeaking, isTranslating, acquireWakeLock]);

  // ─── Pause timers ──────────────────────────────────────────────────────────

  const clearPauseTimers = () => {
    if (shortTimerRef.current) { clearTimeout(shortTimerRef.current); shortTimerRef.current = null; }
    if (longTimerRef.current) { clearTimeout(longTimerRef.current); longTimerRef.current = null; }
  };

  const shouldUsePreview = (value: string) => {
    const { previewMinChars, previewMinWords } = getRealtimeTranslationConfig(1);
    const trimmed = value.trim();
    if (trimmed.length < previewMinChars) return false;
    return trimmed.split(/\s+/).filter(Boolean).length >= previewMinWords;
  };

  const translatePendingSegments = () => {
    const newSegments = segmentsRef.current.slice(translatedCountRef.current);
    if (newSegments.length === 0) return;
    const text = newSegments.join(" ").trim();
    if (!text || !shouldUsePreview(text)) return;
    translatedCountRef.current = segmentsRef.current.length;
    const promise = translateText(text, speakerLang, [targetLang], {
      mode: "tourism",
    })
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
      console.log("[Megaphone] finishAndPlay requested");
      prepareAudioForSafari();
      finishAndPlay();
      return;
    }
    if (isTranslating || isSpeaking || processingRef.current) return;

    console.log("[Megaphone] start SpeechRecognition");
    prepareAudioForSafari();
    suspendAudioForMic();

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
      const combined = [...segments, interimText].filter(Boolean).join(" ");
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
      isListeningRef.current = false;
      setIsListening(false);
      releaseWakeLock();
    };

    rec.onend = () => {
      if (isListeningRef.current && transcriptRef.current.trim()) {
        finishAndPlay();
      } else if (isListeningRef.current) {
        clearPauseTimers();
        isListeningRef.current = false;
        setIsListening(false);
        setTranscript("");
        releaseWakeLock();
      }
    };

    // Reset state
    recognitionRef.current = rec;
    isListeningRef.current = true;
    setIsListening(true);
    listeningStartedAtRef.current = Date.now();
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
      isListeningRef.current = false;
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
    const listenedMs = listeningStartedAtRef.current ? Math.max(0, Date.now() - listeningStartedAtRef.current) : 0;
    listeningStartedAtRef.current = null;

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

    const trialQuota = await consumeTrialQuota("megaphone_ms", listenedMs);
    if (!trialQuota.allowed) {
      setError(getTrialUpgradeMessage(uiLanguage, "megaphone"));
      releaseWakeLock();
      resetIncrementalState();
      processingRef.current = false;
      return;
    }

    // Translate any remaining final segments not yet sent
    if (shouldUsePreview(fullText)) {
      translatePendingSegments();
    }

    // Check for remaining interim text (not finalized by speech recognition)
    const finalJoined = segmentsRef.current.join(" ");
    const remaining = fullText.substring(finalJoined.length).trim();
    if (remaining && shouldUsePreview(remaining)) {
      const promise = translateText(remaining, speakerLang, [targetLang], {
        mode: "tourism",
      })
        .then((r) => r[targetLang] || "...")
        .catch(() => "...");
      translationPromisesRef.current.push(promise);
    }

    // If no chunks at all, translate the whole thing
    if (translationPromisesRef.current.length === 0) {
      const promise = translateText(fullText, speakerLang, [targetLang], {
        mode: "tourism",
      })
        .then((r) => r[targetLang] || "...")
        .catch(() => "...");
      translationPromisesRef.current.push(promise);
    }

    // Show entry
    entryIdRef.current += 1;
    const entryId = entryIdRef.current;
    setEntries((prev) => [...prev, { id: entryId, originalText: fullText, translatedText: "..." }]);
    setIsSpeaking(true);

    // Preview translation chunks for low-latency playback.
    let previewTranslation = "";
    try {
      for (const promise of translationPromisesRef.current) {
        const translated = await promise;
        previewTranslation += (previewTranslation ? " " : "") + translated;

        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, translatedText: previewTranslation } : e))
        );

        if (autoSpeak && translated !== "...") {
          try {
            await playTTS(translated, undefined, undefined, targetLang, userGender);
          } catch (e) {
            console.error("TTS chunk failed:", e);
          }
        }
      }

      const canReusePreviewAsFinal =
        translationPromisesRef.current.length === 1 &&
        segmentsRef.current.join(" ").trim() === fullText &&
        !remaining;
      const { recomputeFinalAfterPreview } = getRealtimeTranslationConfig(1);
      const finalTranslation = canReusePreviewAsFinal
        ? previewTranslation || "..."
        : !recomputeFinalAfterPreview && previewTranslation
          ? previewTranslation
          : (await translateText(fullText, speakerLang, [targetLang], {
              mode: "tourism",
            }))[targetLang] || previewTranslation || "...";
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, translatedText: finalTranslation } : e))
      );
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

  const handleLoadedText = async (text: string) => {
    if (!text.trim() || processingRef.current) return;
    processingRef.current = true;

    prepareAudioForSafari();
    entryIdRef.current += 1;
    const entryId = entryIdRef.current;
    setEntries((prev) => [...prev, { id: entryId, originalText: text, translatedText: "..." }]);
    setIsSpeaking(true);
    setError(null);
    acquireWakeLock();

    try {
      const result = await translateText(text, speakerLang, [targetLang], {
        mode: "tourism",
      });
      const translated = result[targetLang] || "...";
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, translatedText: translated } : e))
      );
      if (autoSpeak && translated !== "...") {
        const sentences = translated.match(/[^.!?]+[.!?]+/g) || [translated];
        for (const sentence of sentences) {
          const s = sentence.trim();
          if (s) {
            try {
              await playTTS(s, undefined, undefined, targetLang, userGender);
            } catch (e) {
              console.error("TTS chunk failed:", e);
            }
          }
        }
      }
    } catch (e: any) {
      console.error("Translation failed:", e);
      const { key, fallback } = getApiErrorMessage(e);
      setError((t as any)[key] || fallback);
    } finally {
      setIsSpeaking(false);
      releaseWakeLock();
      processingRef.current = false;
    }
  };

  const handlePaste = async () => {
    setShowManualPaste((v) => !v);
  };

  const handleManualPasteSubmit = async () => {
    const text = manualPasteText.trim();
    if (!text) return;
    setShowManualPaste(false);
    setManualPasteText("");
    await handleLoadedText(text);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await extractTextFromFile(file);
      if (text.trim()) handleLoadedText(text.trim());
      else setError(t("loadTextEmpty"));
    } catch {
      setError(t("loadTextError"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleShare = async () => {
    const speakerLabel = LANGUAGES.find((l) => l.code === speakerLang)?.label || speakerLang;
    const targetLabel = LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;
    const text = entries.map((e) => `${e.originalText}\n→ ${e.translatedText}`).join("\n\n");
    const shareText = `${t("megaphone")} (${speakerLabel} → ${targetLabel})\n\n${text}`;

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

  const speakerLangObj = LANGUAGES.find((l) => l.code === speakerLang);
  const targetLangObj = LANGUAGES.find((l) => l.code === targetLang);
  const busy = isTranslating || isSpeaking;


  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => { muteAudio(); navigate("/group"); }} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Megaphone className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("megaphone")}</h1>
        <button
          onClick={() => {
            const newVal = !autoSpeak;
            setAutoSpeak(newVal);
            if (!newVal) muteAudio();
            else prepareAudioForSafari();
          }}
          className={`p-2 rounded-xl transition-colors ${
            autoSpeak ? "bg-[#295BDB]/20 text-[#295BDB]" : "bg-[#123182] text-[#F4F4F4]/40"
          }`}
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      <div className="p-4 flex items-center gap-3 border-b border-[#FFFFFF14] bg-[#0E2666]/50 shrink-0">
        <select
          value={speakerLang}
          onChange={(e) => setSpeakerLang(e.target.value)}
          className="min-w-0 flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
        >
          <LanguageOptions />
        </select>
        <span className="text-[#F4F4F4]/40 text-lg">→</span>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="min-w-0 flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
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

      {/* Fixed actions bar: always visible */}
      <div className="px-4 py-2 border-b border-[#FFFFFF14] bg-[#02114A] shrink-0">
        <div className="flex items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.md,.text,.docx,.doc"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={handlePaste}
            disabled={busy || isListening}
            className="p-2.5 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl text-[#F4F4F4]/50 hover:text-[#F4F4F4] hover:bg-[#123182] transition-colors disabled:opacity-40"
          >
            <ClipboardPaste className="w-5 h-5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || isListening}
            className="p-2.5 ml-2 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl text-[#F4F4F4]/50 hover:text-[#F4F4F4] hover:bg-[#123182] transition-colors disabled:opacity-40"
          >
            <FolderOpen className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={handleShare}
            disabled={entries.length === 0}
            className="p-2.5 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl text-[#F4F4F4]/50 hover:text-[#F4F4F4] hover:bg-[#123182] transition-colors disabled:opacity-20 disabled:hover:bg-[#0E2666] disabled:hover:text-[#F4F4F4]/50"
          >
            <Upload className="w-5 h-5" />
          </button>
        </div>
        {showManualPaste && (
          <div className="mt-2 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl p-3 space-y-2">
            <textarea
              value={manualPasteText}
              onChange={(e) => setManualPasteText(e.target.value)}
              placeholder={t("loadTextPaste")}
              rows={4}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] resize-none"
            />
            <button
              onClick={handleManualPasteSubmit}
              disabled={!manualPasteText.trim() || busy || isListening}
              className="w-full py-2.5 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#123182]/80 disabled:opacity-40 transition-colors text-sm font-medium"
            >
              {t("loadTextUse")}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">

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
              <p className="min-w-0 flex-1 break-words whitespace-pre-wrap text-sm leading-relaxed text-[#F4F4F4]/60">
                {entry.originalText}
              </p>
            </div>
            <div className="border-t border-[#FFFFFF14]" />
            <div className="flex items-start gap-2">
              <span className="text-xs text-[#F4F4F4]/40 shrink-0 mt-1">{targetLangObj?.flag}</span>
              <p className="min-w-0 flex-1 break-words whitespace-pre-wrap text-lg font-bold leading-snug text-[#295BDB]">
                {entry.translatedText}
              </p>
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

      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-6 flex flex-col items-center gap-3 shrink-0">
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
