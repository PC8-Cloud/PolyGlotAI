import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLabelForCode, getLocaleForCode } from "../lib/languages";
import { translateText, playTTS, prepareAudioForSafari } from "../lib/openai";

interface Message {
  id: number;
  side: "you" | "them";
  originalText: string;
  translatedText: string;
  sourceLang: string;
}

const SILENCE_TIMEOUT_MS = 2500; // 2.5s silence before processing
const NO_SPEECH_TIMEOUT_MS = 5000; // 5s no speech → switch back
const AUTO_LISTEN_DELAY_MS = 800; // pause after TTS before auto-listening

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
  const [conversationActive, setConversationActive] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [textInputSide, setTextInputSide] = useState<"you" | "them">("you");
  const [showTextInput, setShowTextInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const msgIdRef = useRef(0);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSideRef = useRef<"you" | "them" | null>(null);
  const hasSpokenRef = useRef(false);
  const conversationActiveRef = useRef(false);
  const lastSideRef = useRef<"you" | "them">("you");

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

  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimers();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  const getRecognitionLang = (side: "you" | "them") => {
    if (side === "you") return getLocaleForCode(yourLang);
    return getLocaleForCode(theirLang);
  };

  const otherSide = (side: "you" | "them"): "you" | "them" =>
    side === "you" ? "them" : "you";

  // ─── Timers ─────────────────────────────────────────────────────────────

  const clearAllTimers = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
    if (autoListenTimerRef.current) { clearTimeout(autoListenTimerRef.current); autoListenTimerRef.current = null; }
  };

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (activeSideRef.current && hasSpokenRef.current && transcriptRef.current.trim()) {
        finishListening();
      }
    }, SILENCE_TIMEOUT_MS);
  };

  const startNoSpeechTimer = (currentSide: "you" | "them") => {
    if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
    noSpeechTimerRef.current = setTimeout(() => {
      // No speech detected → switch back to the other side
      if (conversationActiveRef.current && activeSideRef.current === currentSide && !hasSpokenRef.current) {
        stopRecognition();
        const switchTo = otherSide(currentSide);
        startListeningForSide(switchTo);
      }
    }, NO_SPEECH_TIMEOUT_MS);
  };

  // ─── Recognition control ───────────────────────────────────────────────

  const stopRecognition = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setActiveSide(null);
    activeSideRef.current = null;
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;
  };

  const startListeningForSide = useCallback((side: "you" | "them") => {
    if (!conversationActiveRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Stop any existing recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
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
        if (!hasSpokenRef.current) {
          // Cancel no-speech timer — someone is speaking
          if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
        }
        hasSpokenRef.current = true;
        resetSilenceTimer();
      }
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      clearAllTimers();
      if (event.error === "not-allowed" || event.error === "service-not-available") {
        setConversationActive(false);
        conversationActiveRef.current = false;
        setActiveSide(null);
        setTextInputSide(side);
        setShowTextInput(true);
      } else {
        // Try to restart on transient errors
        if (conversationActiveRef.current) {
          setTimeout(() => startListeningForSide(side), 500);
        } else {
          setActiveSide(null);
        }
      }
    };

    rec.onend = () => {
      // Browser auto-ended
      if (activeSideRef.current && transcriptRef.current.trim()) {
        finishListening();
      } else if (conversationActiveRef.current && activeSideRef.current) {
        // No text captured but conversation still active — restart
        setActiveSide(null);
        activeSideRef.current = null;
        setTranscript("");
        setTimeout(() => startListeningForSide(side), 300);
      }
    };

    recognitionRef.current = rec;
    activeSideRef.current = side;
    setActiveSide(side);
    setTranscript("");
    transcriptRef.current = "";
    hasSpokenRef.current = false;
    lastSideRef.current = side;
    setError(null);

    try {
      rec.start();
      // Start no-speech timer
      startNoSpeechTimer(side);
    } catch (e) {
      console.warn("Failed to start speech recognition:", e);
      setActiveSide(null);
      if (!conversationActiveRef.current) {
        setTextInputSide(side);
        setShowTextInput(true);
      }
    }
  }, [yourLang, theirLang]);

  // ─── Start / Stop conversation ──────────────────────────────────────────

  const startConversation = () => {
    prepareAudioForSafari();
    setConversationActive(true);
    conversationActiveRef.current = true;
    setMessages([]);
    setError(null);
    startListeningForSide("you");
  };

  const stopConversation = () => {
    clearAllTimers();
    setConversationActive(false);
    conversationActiveRef.current = false;
    stopRecognition();
  };

  // ─── Finish listening + translate ───────────────────────────────────────

  const finishListening = async () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }

    const side = activeSideRef.current;
    if (!side) return;

    const text = transcriptRef.current.trim();
    stopRecognition();

    if (!text) {
      // No text — if conversation active, restart on same side
      if (conversationActiveRef.current) {
        setTimeout(() => startListeningForSide(side), 300);
      }
      return;
    }

    await processTranslation(text, side);
  };

  // ─── Translate + auto-speak + auto-continue ─────────────────────────────

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

      // Auto-continue: listen on the other side after a brief pause
      if (conversationActiveRef.current) {
        const nextSide = otherSide(side);
        autoListenTimerRef.current = setTimeout(() => {
          if (conversationActiveRef.current) {
            startListeningForSide(nextSide);
          }
        }, AUTO_LISTEN_DELAY_MS);
      }
    } catch (e: any) {
      console.error("Translation failed:", e);
      setIsTranslating(false);
      const msg = e?.message || String(e);
      setError(msg.includes("API key") ? t("apiKeyNotConfigured") : msg.slice(0, 120));

      // Even on error, try to continue conversation
      if (conversationActiveRef.current) {
        autoListenTimerRef.current = setTimeout(() => {
          if (conversationActiveRef.current) {
            startListeningForSide(side); // retry same side
          }
        }, 1000);
      }
    }
  };

  // ─── Text input fallback ──────────────────────────────────────────────

  const handleTextSubmit = async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    setShowTextInput(false);
    await processTranslation(text, textInputSide);
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

  const langOptions = LANGUAGES.map((l) => ({
    code: l.code,
    label: `${l.flag} ${l.label}`,
  }));

  const busy = isTranslating || isSpeaking;
  const listeningYou = activeSide === "you";
  const listeningThem = activeSide === "them";

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => { stopConversation(); navigate("/"); }} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
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
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3 shrink-0">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.length === 0 && !conversationActive && (
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
              <span className="text-xs text-[#F4F4F4]/40 mt-1 block">
                {activeSide === "you" ? t("you") : t("them")} · {t("listening")}
              </span>
            </div>
          </div>
        )}

        {/* Listening indicator */}
        {activeSide && !transcript && (
          <div className={`flex items-center gap-2 text-[#F4F4F4]/40 text-sm ${activeSide === "them" ? "justify-end" : "justify-start"}`}>
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            {activeSide === "you" ? t("you") : t("them")} · {t("listening")}
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
        <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-3 flex items-center gap-2 shrink-0">
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
      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        {/* Language selectors */}
        <div className="grid grid-cols-2 gap-3 px-4 pt-3">
          <div className="flex flex-col items-center gap-1">
            <span className={`text-xs font-medium ${listeningYou ? "text-red-400" : "text-[#F4F4F4]/40"}`}>
              {t("you")} {listeningYou && "●"}
            </span>
            <select
              value={yourLang}
              onChange={(e) => setYourLang(e.target.value)}
              disabled={conversationActive}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className={`text-xs font-medium ${listeningThem ? "text-red-400" : "text-[#F4F4F4]/40"}`}>
              {t("them")} {listeningThem && "●"}
            </span>
            <select
              value={theirLang}
              onChange={(e) => setTheirLang(e.target.value)}
              disabled={conversationActive}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Single start/stop button */}
        <div className="flex flex-col items-center py-4 gap-2">
          <button
            onClick={conversationActive ? stopConversation : startConversation}
            disabled={busy && !conversationActive}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl select-none ${
              conversationActive
                ? "bg-red-500 ring-4 ring-red-500/30 animate-pulse scale-105"
                : "bg-[#295BDB] ring-4 ring-[#295BDB]/20 hover:scale-105"
            }`}
          >
            {conversationActive ? (
              <MicOff className="w-8 h-8" />
            ) : (
              <Mic className="w-8 h-8" />
            )}
          </button>
          <span className="text-xs text-[#F4F4F4]/40">
            {conversationActive ? t("stopConversation") : t("startConversation")}
          </span>
        </div>
      </div>
    </div>
  );
}
