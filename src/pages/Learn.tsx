import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { playTTS, prepareAudioForSafari, getApiErrorMessage, transcribeAudio } from "../lib/openai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "tutor" | "user" | "system";
  text: string;           // target language text
  translation?: string;   // native language translation
  correction?: string;    // correction of user's message (if any)
  hint?: string;          // hint/suggestion for the user
}

interface TutorResponse {
  text: string;
  translation: string;
  correction?: string;
  hint?: string;
}

type Level = "molto_base" | "base" | "intermedio" | "alto" | "madrelingua";
type Topic = "free" | "greetings" | "restaurant" | "directions" | "shopping" | "work" | "travel" | "daily";

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

// ─── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(
  nativeLang: string,
  targetLang: string,
  level: Level,
  topic: Topic,
): string {
  const levelDescriptions: Record<Level, string> = {
    molto_base: "The user is an absolute beginner. Use only the most basic words (hello, yes, no, thank you, numbers 1-10). Keep sentences to 2-4 words max. Always provide translation. Be very patient and encouraging. Introduce one new word at a time.",
    base: "The user is a beginner. Use simple present tense, common vocabulary (greetings, food, directions, numbers). Keep sentences short (3-7 words). Always translate. Gently introduce basic grammar.",
    intermedio: "The user is intermediate. Use varied tenses, richer vocabulary, idiomatic expressions. Sentences can be longer. Explain nuances. Challenge them with questions that require forming their own sentences.",
    alto: "The user is advanced. Use complex grammar, subjunctive, conditionals, idioms, slang. Discuss abstract topics. Point out subtle errors. Push them toward native-like expression.",
    madrelingua: "The user is near-native. Speak completely naturally as you would to a native speaker. Use colloquialisms, humor, cultural references. Only correct very subtle errors. Discuss any topic in depth.",
  };

  const topicContext: Record<Topic, string> = {
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

LEVEL: ${levelDescriptions[level]}

TOPIC: ${topicContext[topic]}

RULES:
- Respond ONLY in valid JSON with this exact format:
  {"text": "your message in ${targetLang}", "translation": "translation in ${nativeLang}", "correction": "correction of user's last message if it had errors, or null", "hint": "a helpful tip or suggestion for the user, or null"}
- Your "text" field must be in ${targetLang}
- Your "translation" field must be in ${nativeLang}
- If the user made a grammar/vocabulary error, put the corrected version in "correction" and explain briefly in ${nativeLang}
- Add "hint" only when useful (grammar tip, cultural note, vocabulary expansion)
- Be encouraging and conversational, not like a textbook
- Adapt your complexity strictly to the level described above
- Start the conversation proactively — greet the user and begin the lesson`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  // Setup state
  const [phase, setPhase] = useState<"setup" | "chat">("setup");
  const [nativeLang, setNativeLang] = useState(uiLanguage || "it");
  const [targetLang, setTargetLang] = useState(
    defaultSourceLanguage === uiLanguage ? "en" : defaultSourceLanguage || "en",
  );
  const [level, setLevel] = useState<Level>("base");
  const [topic, setTopic] = useState<Topic>("free");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [apiMessages, setApiMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ─── Voice recording ──────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return; // too short, ignore

        setLoading(true);
        try {
          const text = await transcribeAudio(blob, targetLang);
          if (text.trim()) {
            setInput(text);
            // Auto-send after transcription
            sendMessageWithText(text);
          }
        } catch (e: any) {
          const { fallback } = getApiErrorMessage(e);
          setError(fallback);
          setLoading(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      console.error("Mic access failed:", e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  // ─── Start lesson ──────────────────────────────────────────────────────────

  const nativeLangLabel = LANGUAGES.find((l) => l.code === nativeLang)?.label || nativeLang;
  const targetLangLabel = LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;

  const startLesson = async () => {
    const systemPrompt = buildSystemPrompt(nativeLangLabel, targetLangLabel, level, topic);
    const initMessages = [{ role: "system" as const, content: systemPrompt }];

    setPhase("chat");
    setMessages([]);
    setApiMessages(initMessages);
    setLoading(true);
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

      setMessages([tutorMsg]);
      setApiMessages([
        ...initMessages,
        { role: "assistant", content: JSON.stringify(data) },
      ]);

      // Auto-speak the first message
      prepareAudioForSafari();
      speakText(data.text, 0);
    } catch (e: any) {
      const { fallback } = getApiErrorMessage(e);
      setError(fallback);
    } finally {
      setLoading(false);
    }
  };

  // ─── Send message ─────────────────────────────────────────────────────────

  const sendMessageWithText = async (msgText: string) => {
    if (!msgText.trim() || loading) return;

    prepareAudioForSafari();
    setInput("");
    setError(null);

    const userMsg: ChatMessage = { role: "user", text: msgText.trim() };
    setMessages((prev) => [...prev, userMsg]);

    const newApiMessages = [
      ...apiMessages,
      { role: "user", content: msgText.trim() },
    ];
    setApiMessages(newApiMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newApiMessages }),
      });
      if (!res.ok) throw { status: res.status, message: "Chat failed" };

      const data: TutorResponse = await res.json();
      const tutorMsg: ChatMessage = {
        role: "tutor",
        text: data.text,
        translation: data.translation,
        correction: data.correction || undefined,
        hint: data.hint || undefined,
      };

      setMessages((prev) => [...prev, tutorMsg]);
      setApiMessages((prev) => [
        ...prev,
        { role: "assistant", content: JSON.stringify(data) },
      ]);

      // Auto-speak tutor reply
      speakText(data.text, messages.length + 1);
    } catch (e: any) {
      const { fallback } = getApiErrorMessage(e);
      setError(fallback);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => sendMessageWithText(input);

  // ─── TTS ──────────────────────────────────────────────────────────────────

  const speakText = async (text: string, idx: number) => {
    setSpeaking(idx);
    try {
      await playTTS(text, undefined, undefined, targetLang);
    } catch (e) {
      console.error("TTS error:", e);
    } finally {
      setSpeaking(null);
    }
  };

  // ─── Reset ────────────────────────────────────────────────────────────────

  const resetLesson = () => {
    setPhase("setup");
    setMessages([]);
    setApiMessages([]);
    setInput("");
    setError(null);
  };

  // ─── Swap languages ─────────────────────────────────────────────────────

  const swapLanguages = () => {
    setNativeLang(targetLang);
    setTargetLang(nativeLang);
  };

  // ─── Render: Setup Phase ──────────────────────────────────────────────────

  const nativeFlag = LANGUAGES.find((l) => l.code === nativeLang)?.flag || "";
  const targetFlagSetup = LANGUAGES.find((l) => l.code === targetLang)?.flag || "";

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
          {/* Language row: native → target with swap */}
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

            <button
              onClick={swapLanguages}
              className="p-2.5 bg-[#295BDB] rounded-xl text-[#F4F4F4] hover:bg-[#295BDB]/80 transition-colors shrink-0"
            >
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

          {/* Level — dropdown */}
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

          {/* Topic */}
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

          {/* Start button */}
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
        <button
          onClick={resetLesson}
          className="p-2 rounded-lg text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]"
        >
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
                {/* Correction of user's previous message */}
                {msg.correction && (
                  <div className="mb-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    <p className="text-xs text-amber-400 font-medium mb-1">✏️ {t("learnCorrection")}</p>
                    <p className="text-sm text-amber-300">{msg.correction}</p>
                  </div>
                )}

                {/* Tutor message bubble */}
                <div className="bg-[#0E2666] rounded-2xl rounded-tl-md p-3 border border-[#FFFFFF14]">
                  <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  <p className="text-xs text-[#F4F4F4]/40 mt-1.5 italic">{msg.translation}</p>

                  {/* Hint */}
                  {msg.hint && (
                    <div className="mt-2 pt-2 border-t border-[#FFFFFF14] flex items-start gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-400/80">{msg.hint}</p>
                    </div>
                  )}
                </div>

                {/* Speaker button */}
                <button
                  onClick={() => {
                    prepareAudioForSafari();
                    speakText(msg.text, idx);
                  }}
                  className={`mt-1 p-1.5 rounded-lg transition-colors ${
                    speaking === idx
                      ? "text-[#295BDB] animate-pulse"
                      : "text-[#F4F4F4]/30 hover:text-[#F4F4F4]/60"
                  }`}
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            );
          }

          // User message
          return (
            <div key={idx} className="flex justify-end">
              <div className="max-w-[85%] bg-[#295BDB] rounded-2xl rounded-tr-md p-3">
                <p className="text-[15px] leading-relaxed">{msg.text}</p>
              </div>
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading && (
          <div className="max-w-[85%]">
            <div className="bg-[#0E2666] rounded-2xl rounded-tl-md p-4 border border-[#FFFFFF14] flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-[#295BDB]" />
              <span className="text-sm text-[#F4F4F4]/40">{t("learnThinking")}</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 p-3 border-t border-[#FFFFFF14] bg-[#0E2666]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex items-center gap-2"
        >
          {/* Mic button */}
          <button
            type="button"
            onTouchStart={(e) => { e.preventDefault(); prepareAudioForSafari(); startRecording(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
            onMouseDown={() => { prepareAudioForSafari(); startRecording(); }}
            onMouseUp={() => stopRecording()}
            disabled={loading}
            className={`p-3 rounded-xl transition-colors shrink-0 ${
              recording
                ? "bg-red-500 text-[#F4F4F4] animate-pulse"
                : "bg-[#123182] text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#295BDB]"
            } disabled:opacity-30`}
          >
            {recording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("learnTypePlaceholder")}
            disabled={loading}
            className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-3 bg-[#295BDB] rounded-xl text-[#F4F4F4] disabled:opacity-30 hover:bg-[#295BDB]/80 transition-colors shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
