import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Send,
  Volume2,
  Loader2,
  RotateCcw,
  Lightbulb,
  BookOpen,
  Coffee,
  MapPin,
  ShoppingBag,
  Briefcase,
  Heart,
  Utensils,
  ArrowRightLeft,
  Mic,
  MicOff,
  Square,
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { playTTS, prepareAudioForSafari, getApiErrorMessage, transcribeAudio } from "../lib/openai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "tutor" | "user";
  text: string;
  translation?: string;
  correction?: string;
  hint?: string;
}

interface TutorResponse {
  text: string;
  translation: string;
  correction?: string;
  hint?: string;
}

type Level = "molto_base" | "base" | "intermedio" | "alto" | "madrelingua";
type Topic = "free" | "greetings" | "restaurant" | "directions" | "shopping" | "work" | "travel" | "daily";
type ChatState = "idle" | "speaking" | "listening" | "transcribing" | "thinking";

const LEVELS: { id: Level; labelKey: string; emoji: string }[] = [
  { id: "molto_base", labelKey: "learnLevelVeryBasic", emoji: "🌱" },
  { id: "base", labelKey: "learnLevelBasic", emoji: "📗" },
  { id: "intermedio", labelKey: "learnLevelIntermediate", emoji: "📘" },
  { id: "alto", labelKey: "learnLevelAdvanced", emoji: "📕" },
  { id: "madrelingua", labelKey: "learnLevelNative", emoji: "🎓" },
];

const TOPICS: { id: Topic; labelKey: string; icon: any }[] = [
  { id: "free", labelKey: "learnTopicFree", icon: Coffee },
  { id: "greetings", labelKey: "learnTopicGreetings", icon: Heart },
  { id: "restaurant", labelKey: "learnTopicRestaurant", icon: Utensils },
  { id: "directions", labelKey: "learnTopicDirections", icon: MapPin },
  { id: "shopping", labelKey: "learnTopicShopping", icon: ShoppingBag },
  { id: "work", labelKey: "learnTopicWork", icon: Briefcase },
  { id: "travel", labelKey: "learnTopicTravel", icon: BookOpen },
  { id: "daily", labelKey: "learnTopicDaily", icon: Lightbulb },
];

// Silence detection threshold (seconds of silence before auto-stop)
const SILENCE_TIMEOUT = 2.0;
const SILENCE_THRESHOLD = 0.015; // audio level below this = silence

// ─── Voice commands (multilingual) ───────────────────────────────────────────

type VoiceCommand = "stop" | "repeat" | "slower" | "faster" | "help" | null;

const VOICE_COMMANDS: Record<string, VoiceCommand> = {
  // Stop / Pause
  stop: "stop", ferma: "stop", basta: "stop", pausa: "stop", pause: "stop",
  arrête: "stop", "arrêter": "stop", parar: "stop", para: "stop", stopp: "stop", halt: "stop",
  // Repeat
  ripeti: "repeat", repeat: "repeat", "répète": "repeat", "répéter": "repeat",
  repite: "repeat", repetir: "repeat", wiederhole: "repeat", wiederholen: "repeat",
  ancora: "repeat", "again": "repeat", "once more": "repeat",
  // Slower
  "più lento": "slower", slower: "slower", "plus lent": "slower",
  "más lento": "slower", langsamer: "slower", lento: "slower",
  // Faster
  "più veloce": "faster", faster: "faster", "plus vite": "faster",
  "más rápido": "faster", schneller: "faster", veloce: "faster",
  // Help
  aiuto: "help", help: "help", aide: "help", ayuda: "help", hilfe: "help",
};

function detectVoiceCommand(text: string): VoiceCommand {
  const normalized = text.toLowerCase().trim().replace(/[.!?,;]+$/, "").trim();
  // Exact match first
  if (VOICE_COMMANDS[normalized]) return VOICE_COMMANDS[normalized];
  // Check if starts with a command word (for phrases like "stop please")
  for (const [key, cmd] of Object.entries(VOICE_COMMANDS)) {
    if (normalized.startsWith(key)) return cmd;
  }
  return null;
}

// ─── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(nativeLang: string, targetLang: string, level: Level, topic: Topic): string {
  const levelDesc: Record<Level, string> = {
    molto_base: "The user is an absolute beginner. Use only the most basic words (hello, yes, no, thank you, numbers 1-10). Keep sentences to 2-4 words max. Always provide translation. Be very patient and encouraging. Introduce one new word at a time.",
    base: "The user is a beginner. Use simple present tense, common vocabulary (greetings, food, directions, numbers). Keep sentences short (3-7 words). Always translate. Gently introduce basic grammar.",
    intermedio: "The user is intermediate. Use varied tenses, richer vocabulary, idiomatic expressions. Sentences can be longer. Explain nuances. Challenge them with questions that require forming their own sentences.",
    alto: "The user is advanced. Use complex grammar, subjunctive, conditionals, idioms, slang. Discuss abstract topics. Point out subtle errors. Push them toward native-like expression.",
    madrelingua: "The user is near-native. Speak completely naturally as you would to a native speaker. Use colloquialisms, humor, cultural references. Only correct very subtle errors. Discuss any topic in depth.",
  };

  const topicDesc: Record<Topic, string> = {
    free: "Have a natural, free-flowing conversation. Choose interesting topics.",
    greetings: "Focus on greetings, introductions, polite expressions, and small talk.",
    restaurant: "Simulate ordering food, asking about the menu, dietary needs, paying the bill.",
    directions: "Practice asking for and giving directions, transportation, locations.",
    shopping: "Practice shopping scenarios: prices, sizes, colors, bargaining, returns.",
    work: "Discuss work, profession, office situations, meetings, emails.",
    travel: "Discuss travel plans, airports, hotels, sightseeing, booking.",
    daily: "Talk about daily routines, weather, family, hobbies, plans for the day.",
  };

  return `You are a friendly language tutor teaching ${targetLang} to a ${nativeLang} speaker.
LEVEL: ${levelDesc[level]}
TOPIC: ${topicDesc[topic]}
RULES:
- Respond ONLY in valid JSON: {"text": "your message in ${targetLang}", "translation": "translation in ${nativeLang}", "correction": "correction of user's error or null", "hint": "tip or null"}
- "text" must be in ${targetLang}, "translation" in ${nativeLang}
- If the user made errors, put correction in ${nativeLang} explaining what was wrong
- Be encouraging and conversational
- Keep responses concise — this is a spoken conversation, not a written one
- Ask questions to keep the conversation going
- Start by greeting and beginning the lesson`;
}

// TTS speed per level — slower for beginners
const LEVEL_SPEED: Record<Level, number> = {
  molto_base: 0.8,
  base: 0.85,
  intermedio: 1.0,
  alto: 1.0,
  madrelingua: 1.0,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  // Setup
  const [phase, setPhase] = useState<"setup" | "chat">("setup");
  const [nativeLang, setNativeLang] = useState(uiLanguage || "it");
  const [targetLang, setTargetLang] = useState(
    defaultSourceLanguage === uiLanguage ? "en" : defaultSourceLanguage || "en",
  );
  const [level, setLevel] = useState<Level>("base");
  const [topic, setTopic] = useState<Topic>("free");

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [apiMessages, setApiMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true); // hands-free auto-listen

  // Speed ref (can be changed by voice commands)
  const currentSpeedRef = useRef(LEVEL_SPEED[level]);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const autoModeRef = useRef(autoMode);
  const apiMessagesRef = useRef(apiMessages);
  const messagesRef = useRef(messages);
  const cancelledRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { currentSpeedRef.current = LEVEL_SPEED[level]; }, [level]);
  useEffect(() => { apiMessagesRef.current = apiMessages; }, [apiMessages]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatState]);

  const nativeLangLabel = LANGUAGES.find((l) => l.code === nativeLang)?.label || nativeLang;
  const targetLangLabel = LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;

  // ─── Silence detection ─────────────────────────────────────────────────────

  const startSilenceDetection = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;

    const check = () => {
      analyser.getByteTimeDomainData(dataArray);
      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms < SILENCE_THRESHOLD) {
        if (!silenceStart) silenceStart = Date.now();
        else if ((Date.now() - silenceStart) / 1000 > SILENCE_TIMEOUT) {
          // Silence detected — stop recording
          stopListening();
          return;
        }
      } else {
        silenceStart = null; // reset on speech
      }

      animFrameRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);

  // ─── Start listening ───────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (cancelledRef.current) return;
    setChatState("listening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for silence detection
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start recording
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

        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000 || cancelledRef.current) {
          // Too short — go back to listening if auto mode
          if (autoModeRef.current && !cancelledRef.current) startListening();
          else setChatState("idle");
          return;
        }

        // Transcribe
        setChatState("transcribing");
        try {
          const text = await transcribeAudio(blob, targetLang);
          if (text.trim() && !cancelledRef.current) {
            // Check for voice commands first
            const cmd = detectVoiceCommand(text);
            if (cmd) {
              handleVoiceCommand(cmd);
              return;
            }
            sendUserMessage(text.trim());
          } else if (autoModeRef.current && !cancelledRef.current) {
            startListening();
          } else {
            setChatState("idle");
          }
        } catch (e: any) {
          const { fallback } = getApiErrorMessage(e);
          setError(fallback);
          setChatState("idle");
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

      // Start silence detection
      startSilenceDetection(analyser);
    } catch (e) {
      console.error("Mic access failed:", e);
      setChatState("idle");
    }
  }, [targetLang, startSilenceDetection]);

  // ─── Stop listening ────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
  }, []);

  // ─── Send user message & get tutor reply ───────────────────────────────────

  const sendUserMessage = useCallback(async (text: string) => {
    if (!text || cancelledRef.current) return;

    prepareAudioForSafari();
    setInput("");
    setError(null);

    const userMsg: ChatMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    const newApiMessages = [...apiMessagesRef.current, { role: "user", content: text }];
    setApiMessages(newApiMessages);
    setChatState("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newApiMessages }),
      });
      if (!res.ok) throw { status: res.status, message: "Chat failed" };

      const data: TutorResponse = await res.json();
      if (cancelledRef.current) return;

      const tutorMsg: ChatMessage = {
        role: "tutor",
        text: data.text,
        translation: data.translation,
        correction: data.correction || undefined,
        hint: data.hint || undefined,
      };

      setMessages((prev) => [...prev, tutorMsg]);
      setApiMessages((prev) => [...prev, { role: "assistant", content: JSON.stringify(data) }]);

      // Speak tutor reply, then auto-listen
      setChatState("speaking");
      try {
        await playTTS(data.text, undefined, currentSpeedRef.current, targetLang);
      } catch (e) {
        console.error("TTS error:", e);
      }

      if (cancelledRef.current) return;

      // After speaking, auto-listen if enabled
      if (autoModeRef.current) {
        startListening();
      } else {
        setChatState("idle");
      }
    } catch (e: any) {
      const { fallback } = getApiErrorMessage(e);
      setError(fallback);
      setChatState("idle");
    }
  }, [targetLang, startListening]);

  // ─── Start lesson ──────────────────────────────────────────────────────────

  const startLesson = async () => {
    prepareAudioForSafari();
    cancelledRef.current = false;

    const systemPrompt = buildSystemPrompt(nativeLangLabel, targetLangLabel, level, topic);
    const initMessages = [{ role: "system" as const, content: systemPrompt }];

    setPhase("chat");
    setMessages([]);
    setApiMessages(initMessages);
    setChatState("thinking");
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: initMessages }),
      });
      if (!res.ok) throw { status: res.status, message: "Chat failed" };

      const data: TutorResponse = await res.json();
      const tutorMsg: ChatMessage = {
        role: "tutor",
        text: data.text,
        translation: data.translation,
        hint: data.hint || undefined,
      };

      const fullApiMessages = [...initMessages, { role: "assistant" as const, content: JSON.stringify(data) }];
      setMessages([tutorMsg]);
      setApiMessages(fullApiMessages);

      // Speak, then auto-listen
      setChatState("speaking");
      try {
        await playTTS(data.text, undefined, currentSpeedRef.current, targetLang);
      } catch (e) {
        console.error("TTS error:", e);
      }

      if (autoModeRef.current && !cancelledRef.current) {
        startListening();
      } else {
        setChatState("idle");
      }
    } catch (e: any) {
      const { fallback } = getApiErrorMessage(e);
      setError(fallback);
      setChatState("idle");
    }
  };

  // ─── Reset ────────────────────────────────────────────────────────────────

  const resetLesson = () => {
    cancelledRef.current = true;
    stopListening();
    setPhase("setup");
    setMessages([]);
    setApiMessages([]);
    setInput("");
    setError(null);
    setChatState("idle");
  };

  // ─── Pause / Resume conversation ─────────────────────────────────────────

  const pauseConversation = () => {
    cancelledRef.current = true;
    setAutoMode(false);
    stopListening();
    // Stop any playing audio
    if (typeof window !== "undefined") {
      document.querySelectorAll("audio").forEach((a) => { a.pause(); a.currentTime = 0; });
    }
    setChatState("idle");
  };

  const resumeConversation = () => {
    cancelledRef.current = false;
    setAutoMode(true);
    prepareAudioForSafari();
    startListening();
  };

  // ─── Replay last tutor message ─────────────────────────────────────────────

  const replayLastTutor = async () => {
    const lastTutor = [...messagesRef.current].reverse().find((m) => m.role === "tutor");
    if (!lastTutor) return;
    setChatState("speaking");
    try {
      await playTTS(lastTutor.text, undefined, LEVEL_SPEED[level], targetLang);
    } catch (e) {
      console.error("TTS replay error:", e);
    }
    if (autoModeRef.current && !cancelledRef.current) {
      startListening();
    } else {
      setChatState("idle");
    }
  };

  // ─── Handle voice command ──────────────────────────────────────────────────

  const handleVoiceCommand = (cmd: VoiceCommand): boolean => {
    if (!cmd) return false;
    switch (cmd) {
      case "stop":
        pauseConversation();
        return true;
      case "repeat":
        replayLastTutor();
        return true;
      case "slower":
        // Decrease speed by 0.1, min 0.7
        currentSpeedRef.current = Math.max(0.7, currentSpeedRef.current - 0.1);
        replayLastTutor();
        return true;
      case "faster":
        // Increase speed by 0.1, max 1.3
        currentSpeedRef.current = Math.min(1.3, currentSpeedRef.current + 0.1);
        replayLastTutor();
        return true;
      case "help":
        // Show available commands
        const helpMsg: ChatMessage = {
          role: "tutor",
          text: "",
          translation: "",
          hint: "🎤 \"Stop/Ferma\" · \"Ripeti/Repeat\" · \"Più lento/Slower\" · \"Più veloce/Faster\"",
        };
        setMessages((prev) => [...prev, helpMsg]);
        if (autoModeRef.current && !cancelledRef.current) startListening();
        else setChatState("idle");
        return true;
    }
    return false;
  };

  // ─── Manual mic toggle ────────────────────────────────────────────────────

  const toggleMic = () => {
    prepareAudioForSafari();
    if (chatState === "listening") {
      stopListening();
    } else if (chatState === "idle") {
      cancelledRef.current = false;
      startListening();
    }
  };

  // ─── Swap languages ───────────────────────────────────────────────────────

  const swapLanguages = () => {
    setNativeLang(targetLang);
    setTargetLang(nativeLang);
  };

  // ─── Status label & color ─────────────────────────────────────────────────

  const statusConfig: Record<ChatState, { label: string; color: string; pulse: boolean }> = {
    idle: { label: "", color: "bg-[#123182]", pulse: false },
    speaking: { label: t("learnSpeaking"), color: "bg-[#295BDB]", pulse: true },
    listening: { label: t("learnListening"), color: "bg-green-500", pulse: true },
    transcribing: { label: t("learnTranscribing"), color: "bg-amber-500", pulse: true },
    thinking: { label: t("learnThinking"), color: "bg-[#295BDB]", pulse: true },
  };

  // ─── Render: Setup Phase ──────────────────────────────────────────────────

  if (phase === "setup") {
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
        <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
          <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold">{t("learn")}</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 max-w-sm mx-auto w-full">
          {/* Language row */}
          <div className="flex items-center gap-2">
            <select
              value={nativeLang}
              onChange={(e) => setNativeLang(e.target.value)}
              className="flex-1 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-3 py-3 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
            <button onClick={swapLanguages} className="p-2.5 bg-[#295BDB] rounded-xl text-[#F4F4F4] hover:bg-[#295BDB]/80 transition-colors shrink-0">
              <ArrowRightLeft className="w-5 h-5" />
            </button>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="flex-1 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-3 py-3 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
            >
              {LANGUAGES.filter((l) => l.code !== nativeLang).map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
          </div>

          {/* Level dropdown */}
          <div>
            <label className="block text-sm font-medium text-[#F4F4F4]/60 mb-2">{t("learnLevel")}</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
              className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
            >
              {LEVELS.map((lv) => (
                <option key={lv.id} value={lv.id}>{lv.emoji} {t(lv.labelKey as any)}</option>
              ))}
            </select>
          </div>

          {/* Topics */}
          <div>
            <label className="block text-sm font-medium text-[#F4F4F4]/60 mb-2">{t("learnTopic")}</label>
            <div className="grid grid-cols-2 gap-2">
              {TOPICS.map((tp) => {
                const Icon = tp.icon;
                return (
                  <button
                    key={tp.id}
                    onClick={() => setTopic(tp.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors border ${
                      topic === tp.id
                        ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                        : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{t(tp.labelKey as any)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start */}
          <button
            onClick={startLesson}
            className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-4 rounded-2xl transition-colors text-lg shadow-lg"
          >
            {t("learnStart")}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Chat Phase ───────────────────────────────────────────────────

  const targetFlag = LANGUAGES.find((l) => l.code === targetLang)?.flag || "";
  const { label: statusLabel, color: statusColor, pulse: statusPulse } = statusConfig[chatState];

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={resetLesson} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold">{targetFlag} {targetLangLabel}</h1>
          <p className="text-xs text-[#F4F4F4]/40">
            {t(LEVELS.find((l) => l.id === level)?.labelKey as any)} · {t(TOPICS.find((tp) => tp.id === topic)?.labelKey as any)}
          </p>
        </div>
        {/* Stop / Resume */}
        {(autoMode || chatState !== "idle") ? (
          <button
            onClick={pauseConversation}
            className="px-3 py-1.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold flex items-center gap-1.5 hover:bg-red-500/30 transition-colors"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            {t("learnStop")}
          </button>
        ) : (
          <button
            onClick={resumeConversation}
            className="px-3 py-1.5 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold flex items-center gap-1.5 hover:bg-green-500/30 transition-colors"
          >
            <Mic className="w-3.5 h-3.5" />
            {t("learnResume")}
          </button>
        )}
        <button onClick={resetLesson} className="p-2 rounded-lg text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]">
          <RotateCcw className="w-5 h-5" />
        </button>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 text-xs">✕</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, idx) => {
          if (msg.role === "tutor") {
            return (
              <div key={idx} className="max-w-[85%]">
                {msg.correction && (
                  <div className="mb-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    <p className="text-xs text-amber-400 font-medium mb-1">✏️ {t("learnCorrection")}</p>
                    <p className="text-sm text-amber-300">{msg.correction}</p>
                  </div>
                )}
                <div className="bg-[#0E2666] rounded-2xl rounded-tl-md p-3 border border-[#FFFFFF14]">
                  <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  <p className="text-xs text-[#F4F4F4]/40 mt-1.5 italic">{msg.translation}</p>
                  {msg.hint && (
                    <div className="mt-2 pt-2 border-t border-[#FFFFFF14] flex items-start gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-400/80">{msg.hint}</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    prepareAudioForSafari();
                    setChatState("speaking");
                    playTTS(msg.text, undefined, currentSpeedRef.current, targetLang)
                      .catch(() => {})
                      .finally(() => setChatState("idle"));
                  }}
                  className="mt-1 p-1.5 rounded-lg transition-colors text-[#F4F4F4]/30 hover:text-[#F4F4F4]/60"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            );
          }
          return (
            <div key={idx} className="flex justify-end">
              <div className="max-w-[85%] bg-[#295BDB] rounded-2xl rounded-tr-md p-3">
                <p className="text-[15px] leading-relaxed">{msg.text}</p>
              </div>
            </div>
          );
        })}

        {/* Status indicator in chat */}
        {chatState !== "idle" && (
          <div className="max-w-[85%]">
            <div className={`rounded-2xl rounded-tl-md p-4 border border-[#FFFFFF14] flex items-center gap-3 ${
              chatState === "listening" ? "bg-green-500/10 border-green-500/20" : "bg-[#0E2666]"
            }`}>
              {chatState === "listening" ? (
                <div className="w-4 h-4 rounded-full bg-green-500 animate-pulse" />
              ) : (
                <Loader2 className="w-4 h-4 animate-spin text-[#295BDB]" />
              )}
              <span className={`text-sm ${chatState === "listening" ? "text-green-400" : "text-[#F4F4F4]/40"}`}>
                {statusLabel}
              </span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Bottom bar — big mic button + text input */}
      <div className="shrink-0 border-t border-[#FFFFFF14] bg-[#0E2666]">
        {/* Status strip */}
        {chatState !== "idle" && (
          <div className={`px-4 py-1.5 text-center text-xs font-medium ${
            chatState === "listening" ? "bg-green-500/20 text-green-400" :
            chatState === "speaking" ? "bg-[#295BDB]/20 text-[#295BDB]" :
            "bg-amber-500/20 text-amber-400"
          } ${statusPulse ? "animate-pulse" : ""}`}>
            {statusLabel}
          </div>
        )}

        <div className="p-3 flex items-center gap-2">
          {/* Big mic button */}
          <button
            type="button"
            onClick={toggleMic}
            disabled={chatState === "thinking" || chatState === "transcribing" || chatState === "speaking"}
            className={`p-4 rounded-2xl transition-all shrink-0 ${
              chatState === "listening"
                ? "bg-green-500 text-[#F4F4F4] shadow-lg shadow-green-500/30 scale-110"
                : "bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB]"
            } disabled:opacity-30`}
          >
            {chatState === "listening" ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          {/* Text input (alternative to voice) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) {
                prepareAudioForSafari();
                sendUserMessage(input.trim());
              }
            }}
            className="flex-1 flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("learnTypePlaceholder")}
              disabled={chatState !== "idle"}
              className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:ring-2 focus:ring-[#295BDB] outline-none text-sm disabled:opacity-30"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!input.trim() || chatState !== "idle"}
              className="p-3 bg-[#295BDB] rounded-xl text-[#F4F4F4] disabled:opacity-30 hover:bg-[#295BDB]/80 transition-colors shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
