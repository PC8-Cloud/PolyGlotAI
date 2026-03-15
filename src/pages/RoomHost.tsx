import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Radio, Users, MessageCircleQuestion, LogOut } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLocaleForCode } from "../lib/languages";
import { translateText } from "../lib/openai";
import { createRoom, sendMessage } from "../lib/firebase-helpers";
import { db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";

interface Participant {
  id: string;
  language: string;
  displayName: string;
}

interface Msg {
  id: string;
  sourceText: string;
  translations: Record<string, string>;
  type: string;
  senderName?: string;
  sourceLanguage?: string;
}

const SILENCE_TIMEOUT_MS = 2000;

export default function RoomHost() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [speakerLang, setSpeakerLang] = useState(defaultSourceLanguage);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Subscribe to participants
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      collection(db, "sessions", sessionId, "participants"),
      (snap) => {
        const list: Participant[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({ id: d.id, language: data.language, displayName: data.displayName });
        });
        setParticipants(list);
      },
    );
    return unsub;
  }, [sessionId]);

  // Subscribe to messages
  useEffect(() => {
    if (!sessionId) return;
    const q = query(collection(db, "sessions", sessionId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: Msg[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({ id: d.id, sourceText: data.sourceText, translations: data.translations || {}, type: data.type || "BROADCAST", senderName: data.senderName, sourceLanguage: data.sourceLanguage });
      });
      setMessages(list);
    });
    return unsub;
  }, [sessionId]);

  // ─── Create room ─────────────────────────────────────────────────────────

  const handleCreateRoom = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await createRoom(speakerLang);
      setSessionId(result.sessionId);
      setRoomCode(result.roomCode);
      setHostId(result.hostId);
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  // ─── Silence detection ────────────────────────────────────────────────────

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

  // ─── Listening ────────────────────────────────────────────────────────────

  const toggleListening = () => {
    if (isListening) {
      finishListening();
      return;
    }
    if (isTranslating) return;

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

    rec.onerror = () => {
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
    } catch {
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
    if (!text || !sessionId || !hostId) return;
    await processTranslation(text);
  };

  // ─── Translate + broadcast ────────────────────────────────────────────────

  const processTranslation = async (text: string) => {
    setIsTranslating(true);
    setError(null);

    try {
      // Collect unique languages from participants
      const targetLangs = [...new Set(participants.map((p) => p.language))].filter(
        (l): l is string => l !== speakerLang,
      );

      let translations: Record<string, string> = {};
      if (targetLangs.length > 0) {
        translations = await translateText(text, speakerLang, targetLangs);
      }
      // Include the source text as its own "translation"
      translations[speakerLang] = text;

      await sendMessage(sessionId!, hostId!, "BROADCAST", speakerLang, text, translations);
    } catch (e: any) {
      console.error("Translation/broadcast failed:", e);
      const msg = e?.message || String(e);
      setError(msg.includes("API key") ? t("apiKeyNotConfigured") : msg.slice(0, 120));
    } finally {
      setIsTranslating(false);
    }
  };

  // ─── Close room ──────────────────────────────────────────────────────────

  const closeRoom = async () => {
    if (!sessionId) return;
    try {
      await updateDoc(doc(db, "sessions", sessionId), { status: "ENDED" });
    } catch (e) {
      console.error("Failed to close room:", e);
    }
    navigate("/group");
  };

  // ─── Language counts for display ──────────────────────────────────────────

  const langCounts: Record<string, number> = {};
  participants.forEach((p) => {
    langCounts[p.language] = (langCounts[p.language] || 0) + 1;
  });

  const langOptions = LANGUAGES.map((l) => ({ code: l.code, label: `${l.flag} ${l.label}` }));

  // ─── Render: room not created yet ─────────────────────────────────────────

  if (!roomCode || !sessionId) {
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
        <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
          <button onClick={() => navigate("/group")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <Radio className="w-5 h-5 text-[#295BDB]" />
          <h1 className="text-lg font-bold">{t("multilingualRoom")}</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-sm mx-auto w-full">
          <Radio className="w-20 h-20 text-[#F4F4F4]/10" />
          <p className="text-[#F4F4F4]/40 text-sm text-center">{t("multilingualRoomDesc")}</p>

          <div className="w-full">
            <label className="text-xs text-[#F4F4F4]/40 mb-2 block">{t("yourLanguage")}</label>
            <select
              value={speakerLang}
              onChange={(e) => setSpeakerLang(e.target.value)}
              className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="w-full p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreateRoom}
            disabled={creating}
            className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-50 text-[#F4F4F4] font-bold py-4 rounded-xl transition-colors text-lg"
          >
            {creating ? "..." : t("createRoom")}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: room active ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate("/group")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Radio className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("multilingualRoom")}</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[#F4F4F4]/60">
            <Users className="w-4 h-4" />
            <span className="text-sm font-bold">{participants.length}</span>
          </div>
          <button onClick={closeRoom} className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Room code banner */}
      <div className="bg-[#0E2666] border-b border-[#FFFFFF14] p-4 flex items-center justify-center gap-4">
        <span className="text-[#F4F4F4]/40 text-sm">{t("roomCode")}:</span>
        <span className="text-4xl font-mono font-black tracking-[0.3em] text-[#295BDB]">{roomCode}</span>
      </div>

      {/* Participants by language */}
      {participants.length > 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-[#FFFFFF14]">
          {Object.entries(langCounts).map(([lang, count]) => {
            const langObj = LANGUAGES.find((l) => l.code === lang);
            return (
              <span
                key={lang}
                className="bg-[#123182] px-3 py-1 rounded-full text-xs text-[#F4F4F4]/80 flex items-center gap-1.5"
              >
                {langObj?.flag} {langObj?.label || lang}
                <span className="bg-[#295BDB]/30 px-1.5 rounded-full text-[#295BDB] font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.length === 0 && !isListening && participants.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("waitingForParticipants")}</p>
          </div>
        )}

        {messages.length === 0 && !isListening && participants.length > 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("tapToSpeak")}</p>
          </div>
        )}

        {messages.map((msg) => {
          const isQuestion = msg.type === "QUESTION";
          // For questions, show the translation in the host's language
          const questionInHostLang = isQuestion ? (msg.translations[speakerLang] || msg.sourceText) : null;

          return (
            <div
              key={msg.id}
              className={`rounded-2xl p-4 border space-y-2 ${
                isQuestion
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-[#0E2666] border-[#FFFFFF14]"
              }`}
            >
              {isQuestion && (
                <div className="flex items-center gap-2 text-amber-400">
                  <MessageCircleQuestion className="w-4 h-4" />
                  <span className="text-xs font-medium">{t("questionFrom")} {msg.senderName || "?"}</span>
                </div>
              )}
              {isQuestion ? (
                <p className="text-base font-bold text-[#F4F4F4]">{questionInHostLang}</p>
              ) : (
                <p className="text-sm text-[#F4F4F4]/80">{msg.sourceText}</p>
              )}
              {isQuestion && msg.sourceText !== questionInHostLang && (
                <p className="text-xs text-[#F4F4F4]/30">{msg.sourceText}</p>
              )}
            </div>
          );
        })}

        {transcript && isListening && (
          <div className="bg-[#123182]/30 rounded-2xl p-4 border border-[#FFFFFF14]/50 italic">
            <p className="text-lg text-[#F4F4F4]/80">{transcript}</p>
            <span className="text-xs text-[#F4F4F4]/40 mt-1 block">{t("listening")}</span>
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

        <div ref={bottomRef} />
      </div>

      {/* Mic */}
      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-6 flex flex-col items-center gap-3">
        <button
          onClick={toggleListening}
          disabled={isTranslating || participants.length === 0}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-2xl disabled:opacity-40 select-none ${
            isListening
              ? "bg-red-500 ring-4 ring-red-500/30 animate-pulse scale-110"
              : "bg-[#295BDB] ring-4 ring-[#295BDB]/20 hover:scale-105"
          }`}
        >
          <Mic className="w-9 h-9" />
        </button>
        <span className="text-xs text-[#F4F4F4]/40">
          {participants.length === 0 ? t("waitingForParticipants") : isListening ? t("tapToStop") : t("tapToSpeak")}
        </span>
      </div>
    </div>
  );
}
