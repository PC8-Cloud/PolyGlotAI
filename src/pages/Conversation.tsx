import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, MicOff, Send, Volume2, VolumeX, ArrowRightLeft } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLabelForCode } from "../lib/languages";
import { translateText, playTTS, prepareAudioForSafari, getApiErrorMessage, transcribeAudioDetectLang } from "../lib/openai";

interface Message {
  id: number;
  side: "you" | "them";
  originalText: string;
  translatedText: string;
  sourceLang: string;
}

// Silence detection
const SILENCE_TIMEOUT = 2.0; // seconds of silence before auto-stop
const SILENCE_THRESHOLD = 0.015;

export default function Conversation() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [yourLang, setYourLang] = useState(defaultSourceLanguage);
  const [theirLang, setTheirLang] = useState(
    defaultSourceLanguage === "en" ? "it" : "en",
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatState]);

  useEffect(() => { yourLangRef.current = yourLang; }, [yourLang]);
  useEffect(() => { theirLangRef.current = theirLang; }, [theirLang]);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => { conversationActiveRef.current = conversationActive; }, [conversationActive]);

  useEffect(() => {
    return () => { stopListening(); };
  }, []);

  // ─── Language matching ──────────────────────────────────────────────────

  /** Map Whisper detected language code to "you" or "them" */
  const detectSide = (detectedLang: string): "you" | "them" => {
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

    // Fallback: default to "you"
    return "you";
  };

  // ─── Silence detection ────────────────────────────────────────────────

  const startSilenceDetection = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;

    const check = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setLiveLevel(rms);

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

  const startListening = useCallback(async () => {
    if (!conversationActiveRef.current || processingRef.current) return;
    setChatState("listening");
    setLiveLevel(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
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

        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) {
          // Too short — re-listen
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
          const { text, language: detectedLang } = await transcribeAudioDetectLang(blob);

          if (!text.trim() || !conversationActiveRef.current) {
            processingRef.current = false;
            if (conversationActiveRef.current) startListening();
            else setChatState("idle");
            return;
          }

          const side = detectSide(detectedLang);
          await processMessage(side, text.trim());
        } catch (e: any) {
          const { key, fallback } = getApiErrorMessage(e);
          setError((t as any)[key] || fallback);
          processingRef.current = false;
          if (conversationActiveRef.current) startListening();
          else setChatState("idle");
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      startSilenceDetection(analyser);
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
      { id: newId, side, originalText: text, translatedText: "...", sourceLang },
    ]);

    setChatState("translating");
    setError(null);

    try {
      const translations = await translateText(text, sourceLang, [targetLang]);
      const translatedText = translations[targetLang] || "...";

      setMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, translatedText } : m))
      );

      // Auto-speak translation
      if (autoSpeakRef.current && translatedText !== "...") {
        setChatState("speaking");
        setPlayingId(newId);
        try {
          await playTTS(translatedText, undefined, undefined, targetLang);
        } catch (e) {
          console.error("TTS failed:", e);
        }
        setPlayingId(null);
      }
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

  const langOptions = LANGUAGES.map((l) => ({
    code: l.code,
    label: `${l.flag} ${l.label}`,
  }));

  const isListening = chatState === "listening";
  const busy = chatState === "translating" || chatState === "speaking" || chatState === "transcribing";

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
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
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

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

        {/* Status indicators */}
        {chatState === "listening" && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-[#F4F4F4]/40">{t("listeningBoth")}</span>
          </div>
        )}

        {chatState === "transcribing" && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm text-amber-400">{t("learnTranscribing")}</span>
          </div>
        )}

        {chatState === "translating" && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="w-3 h-3 rounded-full bg-[#295BDB] animate-pulse" />
            <span className="text-sm text-[#295BDB]">{t("translating")}</span>
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
        {/* Language row */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <select
            value={yourLang}
            onChange={(e) => setYourLang(e.target.value)}
            disabled={conversationActive}
            className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60 truncate"
          >
            {langOptions.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
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
            className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2 text-sm text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-center disabled:opacity-60 truncate"
          >
            {langOptions.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

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

          <div className="w-[52px]" /> {/* spacer for symmetry */}
        </div>

        <p className="text-xs text-[#F4F4F4]/30 text-center pb-3">
          {conversationActive ? t("stopConversation") : t("startConversation")}
        </p>
      </div>
    </div>
  );
}
