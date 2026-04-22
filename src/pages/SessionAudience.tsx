import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
} from "firebase/firestore";
import { useUserStore } from "../lib/store";
import { Mic, MicOff, Send, Share2 } from "lucide-react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { translateText } from "../lib/openai";
import { sendMessage } from "../lib/firebase-helpers";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "../lib/i18n";
import { getLabelForCode } from "../lib/languages";
import { exportAndShare, PdfLine } from "../lib/export-pdf";

export default function SessionAudience() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { userId, language, uiLanguage } = useUserStore();
  const [session, setSession] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [textInput, setTextInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const t = useTranslation(uiLanguage);

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    setTranscript,
    supported,
  } = useSpeechRecognition(language);

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

    return () => {
      unsubSession();
      unsubMessages();
    };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleToggleMic = async () => {
    if (isListening) {
      stopListening();
      if (transcript.trim() && session && userId) {
        setIsTranslating(true);
        try {
          // Translate to host's language
          const translations = await translateText(transcript, language, [
            session.sourceLanguage,
          ], {
            mode: "question",
          });
          await sendMessage(
            sessionId!,
            userId,
            "QUESTION",
            language,
            transcript,
            translations,
          );
          setTranscript("");
        } catch (e) {
          console.error("Failed to send question", e);
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
    if (!textInput.trim() || !session || !userId) return;

    setIsTranslating(true);
    const textToSend = textInput;
    setTextInput("");

    try {
      const translations = await translateText(textToSend, language, [
        session.sourceLanguage,
      ], {
        mode: "question",
      });
      await sendMessage(
        sessionId!,
        userId,
        "QUESTION",
        language,
        textToSend,
        translations,
      );
    } catch (e) {
      console.error("Failed to send question", e);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSharePDF = () => {
    if (messages.length === 0) return;
    const lines: PdfLine[] = messages.map((msg) => {
      const isMyMessage = msg.senderId === userId;
      const displayText = isMyMessage
        ? msg.sourceText
        : (msg.translations?.[language] || msg.sourceText);
      return {
        text: displayText,
        label: isMyMessage ? t("you") : t("host"),
        labelColor: isMyMessage ? "blue" as const : "grey" as const,
      };
    });
    exportAndShare({ title: session?.title || "Session", lines }, `session-${sessionId}.pdf`);
  };

  if (!session)
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex items-center justify-center">
        {t("loading")}
      </div>
    );

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans relative">
      {/* Header */}
      <header className="flex items-center justify-between p-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-[#F4F4F4]/60">
            {session.title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {messages.length > 0 && (
            <button onClick={handleSharePDF} className="p-2 rounded-xl bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <div className="text-sm font-medium text-[#F4F4F4]/60">
            {getLabelForCode(language)}
          </div>
        </div>
      </header>

      {/* Main Content - Split View Style */}
      <main className="flex-1 flex flex-col p-6 max-w-md mx-auto w-full overflow-hidden relative">
        {/* Incoming Messages (Host -> Guest) */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-32 no-scrollbar">
          {messages.map((msg) => {
            const isMyMessage = msg.senderId === userId;
            const isQuestion = msg.type === "QUESTION";

            let displayText = "";
            if (isMyMessage) {
              displayText = msg.sourceText;
            } else if (msg.translations && msg.translations[language]) {
              displayText = msg.translations[language];
            } else if (msg.sourceLanguage === language) {
              displayText = msg.sourceText;
            } else {
              displayText = "...";
            }

            if (isQuestion && !isMyMessage) return null;

            return (
              <div
                key={msg.id}
                className={`flex flex-col w-full ${isMyMessage ? "items-end" : "items-start"}`}
              >
                {!isMyMessage && (
                  <span className="text-xs text-[#F4F4F4]/60 uppercase tracking-wider mb-2 ml-1">
                    {t("host")} ({getLabelForCode(session.sourceLanguage)})
                  </span>
                )}
                <div
                  className={`p-6 rounded-3xl max-w-[90%] ${
                    isMyMessage
                      ? "bg-[#123182] text-[#F4F4F4] rounded-br-sm"
                      : "bg-[#295BDB] text-[#F4F4F4] rounded-bl-sm shadow-2xl shadow-blue-900/20"
                  }`}
                >
                  <p className="text-2xl font-medium leading-tight">
                    {displayText}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Live Transcript Preview */}
          {transcript && (
            <div className="flex flex-col w-full items-end">
              <div className="bg-[#123182]/50 text-[#F4F4F4]/80 p-6 rounded-3xl rounded-br-sm max-w-[90%] border border-[#FFFFFF14]/50">
                <p className="text-2xl font-medium leading-tight italic">
                  {transcript}
                </p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Controls */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent flex flex-col items-center justify-end">
          {isTranslating && (
            <div className="text-[#295BDB] animate-pulse text-sm font-medium mb-4">
              {t("translating")}
            </div>
          )}

          {!supported && (
            <div className="bg-red-900/50 text-red-200 px-4 py-2 rounded-xl text-sm border border-red-800 w-full text-center mb-4">
              {t("speechNotSupported")}
            </div>
          )}

          <div className="flex items-center gap-4 w-full">
            <form onSubmit={handleSendText} className="flex-1 flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t("askQuestion")}
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
              <div className="flex flex-col items-center">
                <button
                  onClick={handleToggleMic}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-2xl shrink-0 ${
                    isListening
                      ? "bg-red-500 hover:bg-red-400 animate-pulse ring-4 ring-red-500/20 scale-110"
                      : "bg-white text-slate-900 hover:bg-slate-200 ring-4 ring-white/10"
                  }`}
                >
                  {isListening ? (
                    <MicOff className="w-6 h-6 text-[#F4F4F4]" />
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
