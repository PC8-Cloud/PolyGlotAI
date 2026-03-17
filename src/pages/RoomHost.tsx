import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, Radio, Users, MessageCircleQuestion, LogOut, QrCode, X, Share2, RotateCcw, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES, getLocaleForCode } from "../lib/languages";
import { translateText } from "../lib/openai";
import { createRoom, sendMessage } from "../lib/firebase-helpers";
import { db } from "../firebase";
import { collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc, where, getDocs, limit } from "firebase/firestore";

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
  const [showQR, setShowQR] = useState(false);
  const [rejoinCode, setRejoinCode] = useState("");
  const [rejoining, setRejoining] = useState(false);
  const [lastRoom, setLastRoom] = useState<{ code: string; sessionId: string; hostId: string } | null>(null);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load last room from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("polyglot_last_room");
      if (saved) setLastRoom(JSON.parse(saved));
    } catch {}
  }, []);

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
      // Save to localStorage for rejoin
      const roomData = { code: result.roomCode, sessionId: result.sessionId, hostId: result.hostId };
      localStorage.setItem("polyglot_last_room", JSON.stringify(roomData));
      setLastRoom(roomData);
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  // ─── Rejoin room ─────────────────────────────────────────────────────────

  const handleRejoin = async (code?: string) => {
    const codeToUse = code || rejoinCode.trim();
    if (!codeToUse || codeToUse.length !== 6) return;
    setRejoining(true);
    setError(null);
    try {
      // Find session by room code
      const q = query(
        collection(db, "sessions"),
        where("roomCode", "==", codeToUse),
        where("status", "==", "ACTIVE"),
        limit(1),
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setError(t("roomNotFound"));
        setRejoining(false);
        return;
      }
      const sessionDoc = snap.docs[0];
      const data = sessionDoc.data();
      setSessionId(sessionDoc.id);
      setRoomCode(codeToUse);
      setHostId(data.hostId);
      setSpeakerLang(data.hostLanguage || defaultSourceLanguage);
      // Update localStorage
      const roomData = { code: codeToUse, sessionId: sessionDoc.id, hostId: data.hostId };
      localStorage.setItem("polyglot_last_room", JSON.stringify(roomData));
      setLastRoom(roomData);
    } catch (e: any) {
      setError(e?.message || "Failed to rejoin");
    } finally {
      setRejoining(false);
    }
  };

  // ─── Share room link ────────────────────────────────────────────────────

  const handleShare = async () => {
    const url = `${window.location.origin}/join?code=${roomCode}`;
    const shareData = {
      title: "PolyGlot AI",
      text: `${t("joinRoom")} - ${t("roomCode")}: ${roomCode}`,
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          // Fallback to clipboard
          await navigator.clipboard.writeText(url);
        }
      }
    } else {
      await navigator.clipboard.writeText(url);
      alert(t("linkCopied"));
    }
  };

  // ─── Print QR ────────────────────────────────────────────────────────────

  const handlePrintQR = () => {
    const url = `${window.location.origin}/join?code=${roomCode}`;
    const win = window.open("", "_blank", "width=400,height=500");
    if (!win) return;
    win.document.write(`
      <html><head><title>PolyGlot AI - Room ${roomCode}</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 30px; }
        h1 { font-size: 22px; margin-bottom: 5px; }
        .code { font-size: 36px; font-weight: 900; letter-spacing: 0.2em; font-family: monospace; margin: 15px 0; }
        .url { font-size: 11px; color: #666; word-break: break-all; margin-top: 15px; }
        @media print { body { padding: 10px; } }
      </style></head><body>
        <h1>PolyGlot AI</h1>
        <p>Scan to join the room</p>
        <div id="qr" style="margin:20px auto; position:relative; display:inline-block;"></div>
        <div class="code">${roomCode}</div>
        <div class="url">${url}</div>
        <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
        <script>
          var qr = qrcode(0, 'M'); qr.addData('${url}'); qr.make();
          var container = document.getElementById('qr');
          container.innerHTML = qr.createSvgTag(6, 0);
          var svg = container.querySelector('svg');
          var w = svg.getAttribute('width');
          var h = svg.getAttribute('height');
          var iconSize = 40;
          var x = (parseInt(w) - iconSize) / 2;
          var y = (parseInt(h) - iconSize) / 2;
          // White background behind icon
          var rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
          rect.setAttribute('x', x - 4); rect.setAttribute('y', y - 4);
          rect.setAttribute('width', iconSize + 8); rect.setAttribute('height', iconSize + 8);
          rect.setAttribute('fill', 'white'); rect.setAttribute('rx', '6');
          svg.appendChild(rect);
          // Icon image
          var img = document.createElementNS('http://www.w3.org/2000/svg','image');
          img.setAttribute('href', '${window.location.origin}/icons/icon-192.png');
          img.setAttribute('x', x); img.setAttribute('y', y);
          img.setAttribute('width', iconSize); img.setAttribute('height', iconSize);
          svg.appendChild(img);
          // Wait for icon to load then print
          var testImg = new Image();
          testImg.onload = function() { setTimeout(function() { window.print(); window.close(); }, 200); };
          testImg.onerror = function() { setTimeout(function() { window.print(); window.close(); }, 200); };
          testImg.src = '${window.location.origin}/icons/icon-192.png';
        <\/script>
      </body></html>
    `);
    win.document.close();
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

      // Send source text immediately so clients see something fast
      const initialTranslations: Record<string, string> = { [speakerLang]: text };
      const msgId = await sendMessage(sessionId!, hostId!, "BROADCAST", speakerLang, text, initialTranslations);

      // Then translate and update the message with translations
      if (targetLangs.length > 0) {
        const translations = await translateText(text, speakerLang, targetLangs);
        translations[speakerLang] = text;
        // Update the message in Firestore with translations
        if (msgId) {
          await updateDoc(doc(db, "sessions", sessionId!, "messages", msgId), { translations });
        }
      }
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

          {/* Rejoin last room */}
          {lastRoom && (
            <button
              onClick={() => handleRejoin(lastRoom.code)}
              disabled={rejoining}
              className="w-full bg-[#123182] hover:bg-[#123182]/80 disabled:opacity-50 text-[#F4F4F4] font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {t("rejoinRoom")} {lastRoom.code}
            </button>
          )}

          {/* Manual rejoin */}
          <div className="w-full border-t border-[#FFFFFF14] pt-4">
            <label className="text-xs text-[#F4F4F4]/40 mb-2 block">{t("rejoinByCode")}</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={rejoinCode}
                onChange={(e) => setRejoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="flex-1 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] text-center font-mono text-lg tracking-widest outline-none focus:ring-2 focus:ring-[#295BDB]"
              />
              <button
                onClick={() => handleRejoin()}
                disabled={rejoining || rejoinCode.length !== 6}
                className="bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 text-[#F4F4F4] font-bold px-5 rounded-xl transition-colors"
              >
                {rejoining ? "..." : "→"}
              </button>
            </div>
          </div>
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
      <div className="bg-[#0E2666] border-b border-[#FFFFFF14] p-4 flex items-center justify-center gap-3">
        <span className="text-[#F4F4F4]/40 text-sm">{t("roomCode")}:</span>
        <span className="text-4xl font-mono font-black tracking-[0.3em] text-[#295BDB]">{roomCode}</span>
        <button
          onClick={() => setShowQR(true)}
          className="p-2 rounded-xl bg-[#295BDB]/20 text-[#295BDB] hover:bg-[#295BDB]/30 transition-colors"
        >
          <QrCode className="w-5 h-5" />
        </button>
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
            <h2 className="text-2xl font-bold mb-2">{t("joinRoom")}</h2>
            <p className="text-[#F4F4F4]/60 text-center mb-8 text-sm">
              {t("scanQR")}
            </p>

            <div className="bg-white p-4 rounded-2xl mb-6">
              <QRCodeSVG
                value={`${window.location.origin}/join?code=${roomCode}`}
                size={200}
                level="M"
                imageSettings={{
                  src: "/icons/icon-192.png",
                  height: 40,
                  width: 40,
                  excavate: true,
                }}
              />
            </div>

            <div className="bg-[#02114A] p-3 rounded-xl w-full text-center text-sm font-mono text-[#F4F4F4]/80 break-all border border-[#FFFFFF14] mb-4">
              {t("roomCode")}: <span className="text-[#295BDB] font-bold text-lg">{roomCode}</span>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-2 bg-[#123182] hover:bg-[#123182]/80 text-[#F4F4F4] py-3 rounded-xl transition-colors"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <button
                onClick={handlePrintQR}
                className="flex-1 flex items-center justify-center gap-2 bg-[#123182] hover:bg-[#123182]/80 text-[#F4F4F4] py-3 rounded-xl transition-colors"
              >
                <Printer className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
