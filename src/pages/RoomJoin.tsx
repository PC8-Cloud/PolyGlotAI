import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Radio, Volume2, VolumeX, Send, MessageCircleQuestion, Upload, MessageCircle } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { findRoomByCode, joinRoom, sendMessage } from "../lib/firebase-helpers";
import { playTTS, translateText, prepareAudioForSafari } from "../lib/openai";
import { db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { muteAudio } from "../lib/openai";
import { canUseLocalTTS, playLocalTTS } from "../lib/offline";
import { openWhatsAppShare } from "../lib/share";

interface Msg {
  id: string;
  sourceText: string;
  translations: Record<string, string>;
  createdAt: any;
  type: string;
  senderName?: string;
  senderId?: string;
  sourceLanguage?: string;
}

export default function RoomJoin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  // Join phase
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [name, setName] = useState("");
  const [myLang, setMyLang] = useState(uiLanguage || "en");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // In-room phase
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const initialLoadRef = useRef(true);
  const joinedAtRef = useRef<number>(Date.now());
  const spokenMsgIds = useRef<Set<string>>(new Set());
  const ttsQueueRef = useRef<{ text: string; id: string }[]>([]);
  const ttsPlayingRef = useRef(false);

  const getCreatedAtMs = (value: any): number | null => {
    if (!value) return null;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.seconds === "number") return value.seconds * 1000;
    if (typeof value === "number") return value;
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  useEffect(() => {
    return () => {
      ttsQueueRef.current = [];
      ttsPlayingRef.current = false;
      muteAudio();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for room closure
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, "sessions", sessionId), (snap) => {
      const data = snap.data();
      if (data?.status === "ENDED") {
        setRoomClosed(true);
      }
    });
    return unsub;
  }, [sessionId]);

  // Subscribe to messages once joined
  useEffect(() => {
    if (!sessionId) return;
    const q = query(collection(db, "sessions", sessionId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: Msg[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          sourceText: data.sourceText,
          translations: data.translations || {},
          createdAt: data.createdAt,
          type: data.type || "BROADCAST",
          senderName: data.senderName,
          senderId: data.senderId,
          sourceLanguage: data.sourceLanguage,
        });
      });
      setMessages(list);

      // Auto-speak logic: wait for translation in myLang before speaking
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        // Mark only true backlog messages as already spoken.
        // Fresh messages that are still waiting for translation must remain eligible for TTS.
        list.forEach((m) => {
          const createdAtMs = getCreatedAtMs(m.createdAt);
          if (createdAtMs !== null && createdAtMs < joinedAtRef.current - 1500) {
            spokenMsgIds.current.add(m.id);
          }
        });
        prevMsgCountRef.current = list.length;
      }
      if (autoSpeak) {
        // Check all BROADCAST messages we haven't spoken yet
        for (const msg of list) {
          if (msg.type !== "BROADCAST") continue;
          if (spokenMsgIds.current.has(msg.id)) continue;
          // Only speak if we have a translation in our language
          const myText = msg.translations[myLang];
          if (myText) {
            spokenMsgIds.current.add(msg.id);
            speakText(myText, msg.id);
          }
          // If no translation yet, don't speak — wait for next snapshot with translations
        }
      }
      prevMsgCountRef.current = list.length;
    });
    return unsub;
  }, [sessionId, autoSpeak, myLang]);

  // ─── Join ─────────────────────────────────────────────────────────────────

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed || !name.trim()) return;

    setJoining(true);
    setJoinError(null);

    try {
      const sid = await findRoomByCode(trimmed);
      if (!sid) {
        setJoinError(t("roomNotFound"));
        setJoining(false);
        return;
      }
      prepareAudioForSafari(); // unlock audio on user gesture
      const pid = await joinRoom(sid, myLang, name.trim());
      joinedAtRef.current = Date.now();
      initialLoadRef.current = true;
      spokenMsgIds.current.clear();
      ttsQueueRef.current = [];
      ttsPlayingRef.current = false;
      setParticipantId(pid);
      setSessionId(sid);
    } catch (e: any) {
      setJoinError(e?.message || "Failed to join");
    } finally {
      setJoining(false);
    }
  };

  // ─── TTS Queue ───────────────────────────────────────────────────────────

  const processTTSQueue = async () => {
    if (ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;

    ttsPlayingRef.current = true;
    prepareAudioForSafari();
    setPlayingId(next.id);
    try {
      if (canUseLocalTTS()) {
        await playLocalTTS(next.text, myLang);
      } else {
        await playTTS(next.text, undefined, undefined, myLang);
      }
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlayingId(null);
      ttsPlayingRef.current = false;
      // Process next in queue
      if (ttsQueueRef.current.length > 0) {
        processTTSQueue();
      }
    }
  };

  const speakText = (text: string, id: string) => {
    if (!text.trim()) return;
    if (playingId === id || ttsQueueRef.current.some((item) => item.id === id)) return;
    ttsQueueRef.current.push({ text, id });
    processTTSQueue();
  };

  // ─── Q&A ─────────────────────────────────────────────────────────────────

  const handleSendQuestion = async () => {
    const text = questionText.trim();
    if (!text || !sessionId || !participantId || sendingQuestion) return;

    setSendingQuestion(true);
    try {
      // Translate the question to the host's language
      const hostLang = messages.find((m) => m.type === "BROADCAST")?.sourceLanguage || messages[0]?.sourceLanguage;
      const allLangs = hostLang ? [hostLang] : [];

      let translations: Record<string, string> = {};
      if (allLangs.length > 0 && allLangs[0] !== myLang) {
        translations = await translateText(text, myLang, allLangs, {
          mode: "question",
        });
      }
      translations[myLang] = text;

      await sendMessage(sessionId, participantId, "QUESTION", myLang, text, translations, name);
      setQuestionText("");
    } catch (e: any) {
      console.error("Failed to send question:", e);
    } finally {
      setSendingQuestion(false);
    }
  };

  const myLangObj = LANGUAGES.find((l) => l.code === myLang);

  // ─── Share ────────────────────────────────────────────────────────────────
  const handleShare = async () => {
    const broadcasts = messages.filter((m) => m.type === "BROADCAST");
    const text = broadcasts
      .map((msg) => {
        const myText = msg.translations[myLang] || msg.sourceText;
        return msg.sourceText !== myText ? `${myText}\n  → ${msg.sourceText}` : myText;
      })
      .join("\n\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "PolyGlot AI", text });
      } catch {}
    }
  };

  const handleWhatsAppShare = () => {
    const broadcasts = messages.filter((m) => m.type === "BROADCAST");
    if (broadcasts.length === 0) return;
    const text = broadcasts
      .map((msg) => {
        const myText = msg.translations[myLang] || msg.sourceText;
        return msg.sourceText !== myText ? `${myText}\n  → ${msg.sourceText}` : myText;
      })
      .join("\n\n");
    openWhatsAppShare(text);
  };

  // ─── Join screen ──────────────────────────────────────────────────────────

  if (!sessionId) {
    return (
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
        <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
          <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <Radio className="w-5 h-5 text-[#295BDB]" />
          <h1 className="text-lg font-bold">{t("joinRoom")}</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5 max-w-sm mx-auto w-full">
          <Radio className="w-16 h-16 text-[#F4F4F4]/10" />

          {/* Room code */}
          <div className="w-full">
            <label className="text-xs text-[#F4F4F4]/40 mb-2 block">{t("roomCode")}</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-4 text-center text-2xl font-mono font-black tracking-[0.2em] text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]"
            />
          </div>

          {/* Name */}
          <div className="w-full">
            <label className="text-xs text-[#F4F4F4]/40 mb-2 block">{t("yourName")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("yourName")}
              className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]"
            />
          </div>

          {/* Language */}
          <div className="w-full">
            <label className="text-xs text-[#F4F4F4]/40 mb-2 block">{t("yourLanguage")}</label>
            <select
              value={myLang}
              onChange={(e) => setMyLang(e.target.value)}
              className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] appearance-none outline-none focus:ring-2 focus:ring-[#295BDB]"
            >
              <LanguageOptions />
            </select>
          </div>

          {joinError && (
            <div className="w-full p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-400">{joinError}</p>
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={joining || code.length < 6 || !name.trim()}
            className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 text-[#F4F4F4] font-bold py-4 rounded-xl transition-colors text-lg"
          >
            {joining ? "..." : t("join")}
          </button>
        </div>
      </div>
    );
  }

  // ─── Room closed screen ──────────────────────────────────────────────────

  if (roomClosed) {
    const hasBroadcasts = messages.filter((m) => m.type === "BROADCAST").length > 0;
    return (
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <Radio className="w-20 h-20 text-[#F4F4F4]/10" />
          <p className="text-lg font-bold text-[#F4F4F4]/60">{t("roomClosed")}</p>
          {hasBroadcasts && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleShare}
                className="flex items-center gap-2 bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-3 px-6 rounded-xl transition-colors"
              >
                <Upload className="w-5 h-5" />
                {t("shareRoom")}
              </button>
              <button
                onClick={handleWhatsAppShare}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                WhatsApp
              </button>
            </div>
          )}
          <button
            onClick={() => navigate("/")}
            className="bg-[#123182] hover:bg-[#0E2666] text-[#F4F4F4] font-bold py-3 px-8 rounded-xl transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // ─── In-room screen ───────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Radio className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">
          {myLangObj?.flag} {name}
        </h1>
        <button
          onClick={() => {
            const newVal = !autoSpeak;
            setAutoSpeak(newVal);
            if (!newVal) {
              ttsQueueRef.current = [];
              ttsPlayingRef.current = false;
              muteAudio();
            }
            else prepareAudioForSafari();
          }}
          className={`p-2 rounded-xl transition-colors ${
            autoSpeak ? "bg-[#295BDB]/20 text-[#295BDB]" : "bg-[#123182] text-[#F4F4F4]/40"
          }`}
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
        {messages.filter((m) => m.type === "BROADCAST").length > 0 && (
          <div className="flex items-center sticky top-0 z-10 bg-[#02114A]/90 backdrop-blur-sm -mx-4 px-4 py-2 -mt-4">
            <div className="flex-1" />
            <button
              onClick={handleWhatsAppShare}
              className="p-2.5 mr-2 bg-green-600 rounded-xl text-white hover:bg-green-500 transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
            </button>
            <button
              onClick={handleShare}
              className="p-2.5 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl text-[#F4F4F4]/50 hover:text-[#F4F4F4] hover:bg-[#123182] transition-colors"
            >
              <Upload className="w-5 h-5" />
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("waitingForHost")}</p>
          </div>
        )}

        {messages.map((msg) => {
          const hasMyTranslation = !!msg.translations[myLang];
          const myText = msg.translations[myLang] || msg.sourceText;
          const isQuestion = msg.type === "QUESTION";
          const isMyQuestion = isQuestion && msg.senderId === participantId;
          // Translation is pending only if: no translation for our lang, source is in a different lang, and it's a broadcast
          const isTranslationPending = !hasMyTranslation && !!msg.sourceLanguage && msg.sourceLanguage !== myLang && !isQuestion;

          return (
            <div
              key={msg.id}
              className={`rounded-2xl p-5 border flex items-start gap-3 ${
                isQuestion
                  ? isMyQuestion
                    ? "bg-amber-500/10 border-amber-500/30 ml-8"
                    : "bg-amber-500/5 border-amber-500/20"
                  : "bg-[#0E2666] border-[#FFFFFF14]"
              }`}
            >
              <div className="flex-1">
                {isQuestion && !isMyQuestion && (
                  <div className="flex items-center gap-1.5 mb-1 text-amber-400">
                    <MessageCircleQuestion className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{msg.senderName || "?"}</span>
                  </div>
                )}
                {isMyQuestion && (
                  <div className="flex items-center gap-1.5 mb-1 text-amber-400">
                    <MessageCircleQuestion className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("questionSent")}</span>
                  </div>
                )}
                {isTranslationPending ? (
                  <p className="text-lg font-bold text-[#295BDB] animate-pulse">{t("translating")}</p>
                ) : (
                  <p className={`text-lg font-bold ${isQuestion ? "text-[#F4F4F4]" : "text-[#295BDB]"}`}>{myText}</p>
                )}
                {msg.sourceText !== myText && !isTranslationPending && (
                  <p className="text-xs text-[#F4F4F4]/30 mt-2">{msg.sourceText}</p>
                )}
              </div>
              {!isQuestion && (
                <button
                  onClick={() => speakText(hasMyTranslation ? myText : "", msg.id)}
                  disabled={playingId !== null || !hasMyTranslation}
                  className={`p-2 rounded-lg shrink-0 transition-colors ${
                    playingId === msg.id
                      ? "text-[#295BDB] animate-pulse"
                      : "text-[#F4F4F4]/30 hover:text-[#F4F4F4]/80"
                  }`}
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              )}
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Question input */}
      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-3 flex items-center gap-2 shrink-0">
        <input
          type="text"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendQuestion()}
          placeholder={t("typeYourQuestion")}
          className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-sm text-[#F4F4F4] outline-none focus:ring-2 focus:ring-amber-500/50 placeholder:text-[#F4F4F4]/30"
        />
        <button
          onClick={handleSendQuestion}
          disabled={!questionText.trim() || sendingQuestion}
          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-30 text-white p-3 rounded-xl transition-colors shrink-0"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
