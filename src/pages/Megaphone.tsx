import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Volume2, VolumeX, Megaphone } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLocaleForCode } from "../lib/languages";
import { translateText, playTTS, prepareAudioForSafari } from "../lib/openai";

interface Entry {
  id: number;
  originalText: string;
  translatedText: string;
}

const SILENCE_TIMEOUT_MS = 2000;

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

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const entryIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (isListeningRef.current && hasSpokenRef.current && transcriptRef.current.trim()) {
        finishListening();
      }
    }, SILENCE_TIMEOUT_MS);
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const toggleListening = () => {
    prepareAudioForSafari(); // unlock audio on user tap
    if (isListening) {
      finishListening();
      return;
    }
    if (isTranslating || isSpeaking) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    const locale = getLocaleForCode(speakerLang);
    if (locale) rec.lang = locale;

    rec.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += r;
        else interimText += r;
      }
      const combined = finalText + interimText;
      setTranscript(combined);
      transcriptRef.current = combined;
      if (combined.trim()) {
        hasSpokenRef.current = true;
        resetSilenceTimer();
      }
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      clearSilenceTimer();
      setIsListening(false);
    };

    rec.onend = () => {
      if (isListeningRef.current && transcriptRef.current.trim()) {
        finishListening();
      } else if (isListeningRef.current) {
        clearSilenceTimer();
        setIsListening(false);
        setTranscript("");
      }
    };

    recognitionRef.current = rec;
    isListeningRef.current = true;
    setIsListening(true);
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;
    setError(null);

    try {
      rec.start();
    } catch (e) {
      console.warn("Failed to start:", e);
      setIsListening(false);
    }
  };

  const finishListening = async () => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    const text = transcriptRef.current.trim();
    setIsListening(false);
    isListeningRef.current = false;
    setTranscript("");
    hasSpokenRef.current = false;
    if (!text) return;
    await processTranslation(text);
  };

  const processTranslation = async (text: string) => {
    setIsTranslating(true);
    setError(null);
    try {
      const translations = await translateText(text, speakerLang, [targetLang]);
      const translatedText = translations[targetLang] || "...";
      entryIdRef.current += 1;
      setEntries((prev) => [
        ...prev,
        { id: entryIdRef.current, originalText: text, translatedText },
      ]);
      setIsTranslating(false);
      if (autoSpeak && translatedText !== "...") {
        setIsSpeaking(true);
        try {
          await playTTS(translatedText, undefined, undefined, targetLang);
        } catch (e) {
          console.error("TTS failed:", e);
        } finally {
          setIsSpeaking(false);
        }
      }
    } catch (e: any) {
      console.error("Translation failed:", e);
      setIsTranslating(false);
      const msg = e?.message || String(e);
      setError(msg.includes("API key") ? t("apiKeyNotConfigured") : msg.slice(0, 120));
    }
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
            <span className="text-xs text-[#F4F4F4]/40 mt-2 block">{t("listening")}</span>
          </div>
        )}

        {isListening && !transcript && (
          <div className="flex items-center justify-center gap-2 text-[#F4F4F4]/40 text-sm py-4">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            {t("listening")}
          </div>
        )}

        {isTranslating && (
          <div className="text-[#295BDB] animate-pulse text-sm text-center">{t("translating")}</div>
        )}

        {isSpeaking && !isTranslating && (
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
