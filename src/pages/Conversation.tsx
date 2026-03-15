import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Send, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLabelForCode, getLocaleForCode } from "../lib/languages";
import { translateText, playTTS } from "../lib/openai";

interface Message {
  id: number;
  side: "you" | "them";
  originalText: string;
  translatedText: string;
  sourceLang: string;
}

const SILENCE_TIMEOUT_MS = 1800;

export default function Conversation() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [yourLang, setYourLang] = useState(defaultSourceLanguage);
  const [theirLang, setTheirLang] = useState(
    defaultSourceLanguage === "en" ? "it" : "en",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSide, setActiveSide] = useState<"you" | "them" | null>(null);
  const [transcript, setTranscript] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [textInputSide, setTextInputSide] = useState<"you" | "them">("you");
  const [showTextInput, setShowTextInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const msgIdRef = useRef(0);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSideRef = useRef<"you" | "them" | null>(null);
  const hasSpokenRef = useRef(false);

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    activeSideRef.current = activeSide;
  }, [activeSide]);

  const getRecognitionLang = (side: "you" | "them") => {
    if (side === "you") return getLocaleForCode(yourLang);
    return getLocaleForCode(theirLang);
  };

  // ─── Silence detection ────────────────────────────────────────────────────

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // Silence detected — auto-stop if we have text
      if (activeSideRef.current && hasSpokenRef.current && transcriptRef.current.trim()) {
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

  // ─── Start / finish listening ─────────────────────────────────────────────

  const toggleListening = (side: "you" | "them") => {
    // If already listening on this side → manual stop
    if (activeSide === side) {
      finishListening();
      return;
    }

    if (activeSide || isTranslating || isSpeaking) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTextInputSide(side);
      setShowTextInput(true);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    const lang = getRecognitionLang(side);
    if (lang) rec.lang = lang;

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
        // Reset silence timer on every new speech
        resetSilenceTimer();
      }
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      clearSilenceTimer();
      if (event.error === "not-allowed" || event.error === "service-not-available") {
        setActiveSide(null);
        setTextInputSide(side);
        setShowTextInput(true);
      } else {
        setActiveSide(null);
      }
    };

    rec.onend = () => {
      // Browser auto-ended (e.g. long silence with no speech at all)
      // If we have text, process it
      if (activeSideRef.current && transcriptRef.current.trim()) {
        finishListening();
      } else if (activeSideRef.current) {
        // No text captured, just reset
        clearSilenceTimer();
        setActiveSide(null);
        setTranscript("");
      }
    };

    recognitionRef.current = rec;
    activeSideRef.current = side;
    setActiveSide(side);
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;
    setError(null);

    try {
      rec.start();
    } catch (e) {
      console.warn("Failed to start speech recognition:", e);
      setActiveSide(null);
      setTextInputSide(side);
      setShowTextInput(true);
    }
  };

  const finishListening = async () => {
    clearSilenceTimer();

    const side = activeSideRef.current;
    if (!side) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    const text = transcriptRef.current.trim();
    setActiveSide(null);
    activeSideRef.current = null;
    setTranscript("");
    hasSpokenRef.current = false;

    if (!text) return;

    await processTranslation(text, side);
  };

  // ─── Translate + auto-speak ───────────────────────────────────────────────

  const processTranslation = async (text: string, side: "you" | "them") => {
    setIsTranslating(true);
    setError(null);

    try {
      const sourceLang = side === "you" ? yourLang : theirLang;
      const targetLang = side === "you" ? theirLang : yourLang;

      const translations = await translateText(text, sourceLang, [targetLang]);
      const translatedText = translations[targetLang] || "...";

      msgIdRef.current += 1;
      const newId = msgIdRef.current;

      setMessages((prev) => [
        ...prev,
        { id: newId, side, originalText: text, translatedText, sourceLang },
      ]);

      setIsTranslating(false);

      if (autoSpeak && translatedText !== "...") {
        setIsSpeaking(true);
        setPlayingId(newId);
        try {
          await playTTS(translatedText, undefined, undefined, targetLang);
        } catch (e) {
          console.error("TTS failed:", e);
        } finally {
          setIsSpeaking(false);
          setPlayingId(null);
        }
      }
    } catch (e: any) {
      console.error("Translation failed:", e);
      setIsTranslating(false);
      const msg = e?.message || String(e);
      setError(msg.includes("API key") ? t("apiKeyNotConfigured") : msg.slice(0, 120));
    }
  };

  // ─── Text input fallback ─────────────────────────────────────────────────

  const handleTextSubmit = async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    setShowTextInput(false);
    await processTranslation(text, textInputSide);
  };

  const handleSpeak = async (text: string, id: number, langCode: string) => {
    if (playingId !== null) return;
    setPlayingId(id);
    try {
      await playTTS(text, undefined, undefined, langCode);
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlayingId(null);
    }
  };

  const langOptions = LANGUAGES.map((l) => ({
    code: l.code,
    label: `${l.flag} ${l.label}`,
  }));

  const busy = isTranslating || isSpeaking;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold flex-1">{t("conversation")}</h1>
        <button
          onClick={() => setAutoSpeak(!autoSpeak)}
          className={`p-2 rounded-xl transition-colors ${
            autoSpeak ? "bg-[#295BDB]/20 text-[#295BDB]" : "bg-[#123182] text-[#F4F4F4]/40"
          }`}
          title={autoSpeak ? t("autoSpeakOn") : t("autoSpeakOff")}
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.length === 0 && !activeSide && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("tapToSpeak")}</p>
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
              <p className="text-sm opacity-60 mt-1">{msg.originalText}</p>
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

        {/* Live transcript */}
        {transcript && activeSide && (
          <div className={`flex flex-col gap-1 ${activeSide === "you" ? "items-start" : "items-end"}`}>
            <div className="bg-[#123182]/50 text-[#F4F4F4]/80 p-4 rounded-2xl max-w-[85%] border border-[#FFFFFF14]/50 italic">
              <p className="text-lg">{transcript}</p>
              <span className="text-xs text-[#F4F4F4]/40 mt-1 block">{t("listening")}</span>
            </div>
          </div>
        )}

        {/* Listening but no text yet */}
        {activeSide && !transcript && (
          <div className="flex items-center justify-center gap-2 text-[#F4F4F4]/40 text-sm">
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

        <div ref={messagesEndRef} />
      </div>

      {/* Text input fallback */}
      {showTextInput && (
        <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-3 flex items-center gap-2">
          <span className="text-xs text-[#F4F4F4]/40 shrink-0">
            {textInputSide === "you" ? t("you") : t("them")}
          </span>
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
      )}

      {/* Bottom controls */}
      <div className="border-t border-[#FFFFFF14] bg-[#0E2666]">
        {!speechSupported && !showTextInput && (
          <div className="text-center py-2 px-4">
            <button
              onClick={() => { setTextInputSide("you"); setShowTextInput(true); }}
              className="text-xs text-[#295BDB] underline"
            >
              {t("typeMessage")}
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 divide-x divide-[#FFFFFF14]">
          {/* YOUR side */}
          <div className="flex flex-col items-center p-4 gap-3">
            <select
              value={yourLang}
              onChange={(e) => setYourLang(e.target.value)}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>

            <button
              onClick={() => toggleListening("you")}
              disabled={busy || (activeSide !== null && activeSide !== "you")}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl disabled:opacity-40 select-none ${
                activeSide === "you"
                  ? "bg-red-500 ring-4 ring-red-500/30 animate-pulse scale-110"
                  : "bg-[#295BDB] ring-4 ring-[#295BDB]/20"
              }`}
            >
              <Mic className="w-7 h-7" />
            </button>
            <span className="text-xs text-[#F4F4F4]/40">{t("you")}</span>
          </div>

          {/* THEIR side */}
          <div className="flex flex-col items-center p-4 gap-3">
            <select
              value={theirLang}
              onChange={(e) => setTheirLang(e.target.value)}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>

            <button
              onClick={() => toggleListening("them")}
              disabled={busy || (activeSide !== null && activeSide !== "them")}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl disabled:opacity-40 select-none ${
                activeSide === "them"
                  ? "bg-red-500 ring-4 ring-red-500/30 animate-pulse scale-110"
                  : "bg-[#F4F4F4] text-[#02114A] ring-4 ring-[#F4F4F4]/10"
              }`}
            >
              <Mic className="w-7 h-7" />
            </button>
            <span className="text-xs text-[#F4F4F4]/40">{t("them")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
