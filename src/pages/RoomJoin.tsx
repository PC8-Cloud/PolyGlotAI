import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Radio, Volume2, VolumeX, Send, MessageCircleQuestion, FileDown } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { findRoomByCode, joinRoom, sendMessage } from "../lib/firebase-helpers";
import { playTTS, translateText, prepareAudioForSafari } from "../lib/openai";
import { db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { jsPDF } from "jspdf";

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
  const ttsQueueRef = useRef<{ text: string; id: string }[]>([]);
  const ttsPlayingRef = useRef(false);

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

      // Auto-speak only new messages (skip initial load of existing history)
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        prevMsgCountRef.current = list.length;
        return;
      }
      if (autoSpeak && list.length > prevMsgCountRef.current && list.length > 0) {
        const newest = list[list.length - 1];
        const myText = newest.translations[myLang] || newest.sourceText;
        if (myText) {
          speakText(myText, newest.id);
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
      const pid = await joinRoom(sid, myLang, name.trim());
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
      await playTTS(next.text, undefined, undefined, myLang);
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
        translations = await translateText(text, myLang, allLangs);
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

  const langOptions = LANGUAGES.map((l) => ({ code: l.code, label: `${l.flag} ${l.label}` }));
  const myLangObj = LANGUAGES.find((l) => l.code === myLang);

  // ─── PDF Export ──────────────────────────────────────────────────────────
  const exportPDF = () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = margin;

    const addPage = () => { pdf.addPage(); y = margin; };
    const checkSpace = (need: number) => { if (y + need > pageH - margin) addPage(); };

    // ── Header
    pdf.setFillColor(1, 11, 46); // #010B2E
    pdf.rect(0, 0, pageW, 40, "F");
    pdf.setTextColor(244, 244, 244);
    pdf.setFontSize(20);
    pdf.setFont("helvetica", "bold");
    pdf.text("PolyGlot AI", margin, 18);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(244, 244, 244);
    const dateStr = new Date().toLocaleDateString(myLang, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    pdf.text(dateStr, margin, 28);
    const langLabel = myLangObj?.label || myLang;
    pdf.text(langLabel, pageW - margin, 28, { align: "right" });
    y = 50;

    // ── Title
    pdf.setTextColor(41, 91, 219); // #295BDB
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text(t("pdfTitle"), margin, y);
    y += 10;

    // ── Separator
    pdf.setDrawColor(41, 91, 219);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageW - margin, y);
    y += 8;

    // ── Messages
    const broadcasts = messages.filter((m) => m.type === "BROADCAST");

    if (broadcasts.length === 0) {
      pdf.setTextColor(100, 100, 100);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "italic");
      pdf.text(t("noMessages"), margin, y);
    } else {
      broadcasts.forEach((msg, idx) => {
        checkSpace(25);

        // Message number
        pdf.setFillColor(41, 91, 219);
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        const numW = 7;
        pdf.roundedRect(margin, y - 4, numW, 6, 1, 1, "F");
        pdf.text(String(idx + 1), margin + numW / 2, y, { align: "center" });

        // Translation (main text)
        const myText = msg.translations[myLang] || msg.sourceText;
        pdf.setTextColor(30, 30, 30);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        const lines = pdf.splitTextToSize(myText, contentW - numW - 4);
        pdf.text(lines, margin + numW + 3, y);
        y += lines.length * 5.5;

        // Source text (if different)
        if (msg.sourceText !== myText) {
          checkSpace(10);
          pdf.setTextColor(130, 130, 130);
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "italic");
          const srcLines = pdf.splitTextToSize(msg.sourceText, contentW - numW - 4);
          pdf.text(srcLines, margin + numW + 3, y);
          y += srcLines.length * 4.5;
        }

        y += 5;

        // Light separator between messages
        if (idx < broadcasts.length - 1) {
          checkSpace(3);
          pdf.setDrawColor(220, 220, 220);
          pdf.setLineWidth(0.2);
          pdf.line(margin + numW + 3, y - 2, pageW - margin, y - 2);
          y += 3;
        }
      });
    }

    // ── Footer on last page
    pdf.setTextColor(160, 160, 160);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.text("Generated by PolyGlot AI — polyglotai.app", pageW / 2, pageH - 8, { align: "center" });

    // ── Save
    pdf.save(`PolyGlot-${dateStr.replace(/[/:, ]+/g, "-")}.pdf`);
  };

  // ─── Join screen ──────────────────────────────────────────────────────────

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
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
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
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
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <Radio className="w-20 h-20 text-[#F4F4F4]/10" />
          <p className="text-lg font-bold text-[#F4F4F4]/60">{t("roomClosed")}</p>
          {hasBroadcasts && (
            <button
              onClick={exportPDF}
              className="flex items-center gap-2 bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-3 px-6 rounded-xl transition-colors"
            >
              <FileDown className="w-5 h-5" />
              {t("savePDF")}
            </button>
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
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Radio className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">
          {myLangObj?.flag} {name}
        </h1>
        {messages.filter((m) => m.type === "BROADCAST").length > 0 && (
          <button
            onClick={exportPDF}
            className="p-2 rounded-xl transition-colors bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB]"
            title={t("savePDF")}
          >
            <FileDown className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={() => setAutoSpeak(!autoSpeak)}
          className={`p-2 rounded-xl transition-colors ${
            autoSpeak ? "bg-[#295BDB]/20 text-[#295BDB]" : "bg-[#123182] text-[#F4F4F4]/40"
          }`}
        >
          {autoSpeak ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#F4F4F4]/30 text-sm text-center px-8">{t("waitingForHost")}</p>
          </div>
        )}

        {messages.map((msg) => {
          const myText = msg.translations[myLang] || msg.sourceText;
          const isQuestion = msg.type === "QUESTION";
          const isMyQuestion = isQuestion && msg.senderId === participantId;

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
                <p className={`text-lg font-bold ${isQuestion ? "text-[#F4F4F4]" : "text-[#295BDB]"}`}>{myText}</p>
                {msg.sourceText !== myText && (
                  <p className="text-xs text-[#F4F4F4]/30 mt-2">{msg.sourceText}</p>
                )}
              </div>
              {!isQuestion && (
                <button
                  onClick={() => speakText(myText, msg.id)}
                  disabled={playingId !== null}
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
      <div className="border-t border-[#FFFFFF14] bg-[#0E2666] p-3 flex items-center gap-2">
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
