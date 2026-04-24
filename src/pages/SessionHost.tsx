import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db, auth } from "../firebase";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Mic, MicOff, Settings, Users, X, Send, Share2 } from "lucide-react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { translateText } from "../lib/openai";
import { sendMessage } from "../lib/firebase-helpers";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { getLabelForCode } from "../lib/languages";
import { exportAndShare, PdfLine } from "../lib/export-pdf";

export default function SessionHost() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [textInput, setTextInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    setTranscript,
    supported,
  } = useSpeechRecognition(session?.sourceLanguage || "en-US");

  useEffect(() => {
    if (!sessionId) return;

    const unsubSession = onSnapshot(doc(db, "sessions", sessionId), (doc) => {
      if (doc.exists()) {
        setSession(doc.data());
      }
    });

    const qMessages = query(
      collection(db, `sessions/${sessionId}/messages`),
      orderBy("createdAt", "asc"),
    );
    const unsubMessages = onSnapshot(qMessages, (snapshot) => {
      setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const qParticipants = query(
      collection(db, `sessions/${sessionId}/participants`),
      orderBy("joinedAt", "asc"),
    );
    const unsubParticipants = onSnapshot(qParticipants, (snapshot) => {
      setParticipants(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubSession();
      unsubMessages();
      unsubParticipants();
    };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, transcript]);

  const handleToggleMic = async () => {
    if (isListening) {
      stopListening();
      if (transcript.trim() && session) {
        setIsTranslating(true);
        try {
          const translations = await translateText(
            transcript,
            session.sourceLanguage,
            session.targetLanguages,
            { mode: "live" },
          );
          await sendMessage(
            sessionId!,
            auth.currentUser!.uid,
            "BROADCAST",
            session.sourceLanguage,
            transcript,
            translations,
          );
          setTranscript("");
        } catch (e) {
          console.error("Failed to translate and send", e);
        } finally {
          setIsTranslating(false);
        }
      }
    } else {
      startListening();
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textInput.trim() || !session) return;

    setIsTranslating(true);
    const textToSend = textInput;
    setTextInput("");

    try {
      const translations = await translateText(
        textToSend,
        session.sourceLanguage,
        session.targetLanguages,
        { mode: "live" },
      );
      await sendMessage(
        sessionId!,
        auth.currentUser!.uid,
        "BROADCAST",
        session.sourceLanguage,
        textToSend,
        translations,
      );
    } catch (e) {
      console.error("Failed to translate and send", e);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSharePDF = () => {
    if (messages.length === 0) return;
    const lines: PdfLine[] = messages.map((msg) => ({
      text: msg.sourceText,
      subtext: msg.type === "QUESTION" ? `(${t("question")})` : undefined,
      label: msg.type === "QUESTION" ? "Q" : undefined,
      labelColor: msg.type === "QUESTION" ? "amber" as const : undefined,
    }));
    exportAndShare({ title: session?.title || "Session", lines }, `session-${sessionId}.pdf`);
  };

  if (!session)
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex items-center justify-center">
        {t("loading")}
      </div>
    );

  const joinUrl = `${(import.meta as any).env.VITE_APP_URL || window.location.origin}/join/${sessionId}`;

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666]">
        <div>
          <h1 className="text-xl font-bold">{session.title}</h1>
          <div className="text-xs text-[#F4F4F4]/60 flex items-center gap-2 mt-1">
            <span className="bg-blue-900 text-blue-200 px-2 py-0.5 rounded-full">
              {getLabelForCode(session.sourceLanguage)}
            </span>
            <span>→</span>
            {session.targetLanguages.map((lang: string) => (
              <span
                key={lang}
                className="bg-[#123182] px-2 py-0.5 rounded-full"
              >
                {getLabelForCode(lang)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {messages.length > 0 && (
            <button onClick={handleSharePDF} className="p-2 rounded-xl bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowQR(true)}
            className="flex items-center gap-2 bg-[#123182] hover:bg-[#123182] px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Users className="w-4 h-4" />
            <span>
              {participants.length} {t("joined")}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 max-w-3xl mx-auto w-full gap-4">
        {/* Transcript Area */}
        <div className="flex-1 bg-[#0E2666] rounded-3xl p-6 overflow-y-auto flex flex-col gap-4 border border-[#FFFFFF14] shadow-inner">
          {messages.map((msg) => {
            if (msg.type === "BROADCAST") {
              return (
                <div key={msg.id} className="flex flex-col gap-1">
                  <div className="bg-blue-900/40 text-blue-100 p-4 rounded-2xl rounded-tl-sm self-start max-w-[85%]">
                    <p className="text-lg">{msg.sourceText}</p>
                  </div>
                </div>
              );
            }
            if (msg.type === "QUESTION") {
              return (
                <div key={msg.id} className="flex flex-col gap-1 items-end">
                  <div className="bg-[#123182] text-slate-200 p-4 rounded-2xl rounded-tr-sm self-end max-w-[85%] border border-[#FFFFFF14]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="bg-slate-700 text-xs px-2 py-0.5 rounded-full">
                        {getLabelForCode(msg.sourceLanguage)}
                      </span>
                      <span className="text-xs text-[#F4F4F4]/60">
                        {t("question")}
                      </span>
                    </div>
                    <p className="text-lg">
                      {msg.translations[session.sourceLanguage] ||
                        msg.sourceText}
                    </p>
                  </div>
                </div>
              );
            }
            return null;
          })}

          {/* Live Transcript Preview */}
          {transcript && (
            <div className="bg-[#123182]/50 text-[#F4F4F4]/80 p-4 rounded-2xl rounded-tl-sm self-start max-w-[85%] italic border border-[#FFFFFF14]/50">
              <p className="text-lg">{transcript}</p>
              <span className="text-xs text-[#F4F4F4]/60 mt-2 block">
                {t("listening")}
              </span>
            </div>
          )}

          {isTranslating && (
            <div className="text-[#F4F4F4]/60 text-sm animate-pulse flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              {t("translating")}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center justify-center py-4 gap-4">
          {!supported && (
            <div className="bg-red-900/50 text-red-200 px-4 py-2 rounded-xl text-sm border border-red-800 w-full text-center">
              {t("speechNotSupported")}
            </div>
          )}

          <div className="flex items-center gap-4 w-full">
            <form onSubmit={handleSendText} className="flex-1 flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t("typeMessage")}
                className="flex-1 bg-[#123182] border border-[#FFFFFF14] rounded-2xl px-4 py-3 text-[#F4F4F4] focus:outline-none focus:ring-2 focus:ring-[#295BDB]"
              />
              <button
                type="submit"
                disabled={!textInput.trim() || isTranslating}
                className="bg-[#295BDB] hover:bg-[#295BDB] disabled:opacity-50 disabled:hover:bg-[#295BDB] p-3 rounded-2xl transition-colors shrink-0"
              >
                <Send className="w-6 h-6" />
              </button>
            </form>

            {supported && (
              <button
                onClick={handleToggleMic}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl shrink-0 ${
                  isListening
                    ? "bg-red-500 hover:bg-red-400 animate-pulse ring-4 ring-red-500/30"
                    : "bg-[#295BDB] hover:bg-[#295BDB] ring-4 ring-blue-600/30"
                }`}
              >
                {isListening ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </button>
            )}
          </div>
        </div>
      </main>

      {/* QR Code Modal */}
      {showQR && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0E2666] p-8 rounded-3xl max-w-sm w-full flex flex-col items-center relative border border-[#FFFFFF14]">
            <button
              onClick={() => setShowQR(false)}
              className="absolute top-4 right-4 text-[#F4F4F4]/60 hover:text-[#F4F4F4]"
            >
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold mb-2">{t("joinSession")}</h2>
            <p className="text-[#F4F4F4]/60 text-center mb-8 text-sm">
              {t("scanQR")}
            </p>

            <div className="bg-white p-4 rounded-2xl mb-6">
              <QRCodeSVG value={joinUrl} size={200} />
            </div>

            <div className="bg-[#02114A] p-3 rounded-xl w-full text-center text-sm font-mono text-[#F4F4F4]/80 break-all border border-[#FFFFFF14]">
              {joinUrl}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
