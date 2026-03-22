import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
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
  Upload,
  GraduationCap,
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
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
type LearnMode = "conversation" | "vocabulary";
type VocabState = "loading" | "ready" | "listening" | "evaluating" | "correct" | "wrong" | "complete";

interface VocabWord {
  word: string;
  translation: string;
  phonetic: string;
}

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

const VOCAB_CATS: { id: string; labelKey: string; emoji: string }[] = [
  { id: "numbers", labelKey: "vocabNumbers", emoji: "🔢" },
  { id: "months", labelKey: "vocabMonths", emoji: "📅" },
  { id: "days", labelKey: "vocabDays", emoji: "🗓️" },
  { id: "colors", labelKey: "vocabColors", emoji: "🎨" },
  { id: "food", labelKey: "vocabFood", emoji: "🍕" },
  { id: "animals", labelKey: "vocabAnimals", emoji: "🐾" },
  { id: "body", labelKey: "vocabBody", emoji: "🧍" },
  { id: "family", labelKey: "vocabFamily", emoji: "👨‍👩‍👧" },
  { id: "random", labelKey: "vocabRandom", emoji: "🎲" },
];

function buildVocabPrompt(nativeLang: string, targetLang: string, category: string): string {
  const catDescs: Record<string, string> = {
    numbers: "Numbers from 1 to 20, in order",
    months: "All 12 months of the year, in order",
    days: "All 7 days of the week, in order",
    colors: "10 common colors",
    food: "10 common food items and drinks",
    animals: "10 common animals",
    body: "10 body parts",
    family: "10 family member terms (mother, father, brother, etc.)",
    random: "10 random useful everyday words — pick a fun, surprising category each time (e.g. professions, emotions, weather, sports, kitchen tools, etc.)",
  };

  return `Generate vocabulary words in ${targetLang} for a ${nativeLang} speaker.
Category: ${catDescs[category] || catDescs.random}

Rules:
- For sequential categories (numbers, months, days), include ALL items in their natural order
- For other categories, pick exactly 10 practical, commonly-used words
- For "phonetic": write how to pronounce the ${targetLang} word using ${nativeLang} sounds/letters so the learner can read it and approximate the pronunciation
- Keep the phonetic simple and readable

Respond ONLY with a valid JSON object containing a "words" array:
{"words": [{"word": "word in ${targetLang}", "translation": "translation in ${nativeLang}", "phonetic": "pronunciation in ${nativeLang} sounds"}]}`;
}

function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen;
}

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

function buildSystemPrompt(nativeLang: string, targetLang: string, level: Level, topic: Topic, studentName?: string, studentGender?: string): string {
  const levelDesc: Record<Level, string> = {
    molto_base: `The user is an absolute beginner. You are their patient, warm teacher.
- Use only the most basic words (hello, yes, no, thank you, numbers 1-10). 2-4 words max.
- Always provide translation.
- Introduce ONE new word at a time. Ask them to repeat it.
- If they say it wrong, gently correct them: say the correct version, explain the pronunciation in ${nativeLang}, and ask them to try again.
- If they say it right, praise them enthusiastically and move to the next word.
- Give them simple choices: "Do you want to say A or B?" to help them form answers.
- Speak to them in ${nativeLang} for explanations, but always give the ${targetLang} phrase to practice.`,

    base: `The user is a beginner. You are a supportive teacher guiding them step by step.
- Use simple present tense, common vocabulary (greetings, food, directions, numbers). 3-7 words.
- Always translate. Gently introduce basic grammar.
- When they make mistakes, ALWAYS correct them: explain the rule briefly in ${nativeLang}, give the correct sentence, and ask them to repeat.
- If their sentence structure is wrong, show them the right pattern.
- Suggest how to say things better. Give alternatives.
- Ask follow-up questions that require them to use what they just learned.`,

    intermedio: "The user is intermediate. Use varied tenses, richer vocabulary, idiomatic expressions. Sentences can be longer. Explain nuances. Challenge them with questions that require forming their own sentences. Correct errors and explain why.",
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

  const isBeginnerLevel = level === "molto_base" || level === "base";

  const studentInfo = studentName
    ? `\nSTUDENT: Their name is ${studentName}.${studentGender ? ` Use ${studentGender === "male" ? "masculine" : "feminine"} grammatical forms when addressing them.` : ""} Call them by name occasionally to make the conversation personal.`
    : "";

  return `You are a friendly language tutor teaching ${targetLang} to a ${nativeLang} speaker.${studentInfo}
LEVEL: ${levelDesc[level]}
TOPIC: ${topicDesc[topic]}

RESPONSE FORMAT — respond ONLY in valid JSON:
{"text": "your message in ${targetLang}", "translation": "translation in ${nativeLang}", "correction": "correction of user's error in ${nativeLang} or null", "hint": "tip in ${nativeLang} or null"}

RULES:
- "text" must be in ${targetLang}, "translation" in ${nativeLang}
- If the user made errors, put the FULL correction in ${nativeLang}: what was wrong, the correct version, and why
- Keep responses concise — this is a SPOKEN conversation
- Ask questions to keep the conversation going
- Start by greeting${studentName ? ` ${studentName}` : ""} and beginning the lesson
- In your FIRST message only, briefly mention in the "hint" field that voice commands are available: repeat, slower, faster, stop (in ${nativeLang})
${isBeginnerLevel ? `
TEACHER MODE (because the user is a beginner):
- If the user sends "[NO_RESPONSE]", it means they stayed silent. Respond in ${nativeLang} in the "translation" field, encouraging them. Ask if they need help. Suggest what they could say. In "text" give them the exact phrase to repeat.
- If their answer is very wrong or nonsensical, don't just continue — stop, explain in ${nativeLang} what they should have said, give the correct phrase in ${targetLang}, and ask them to try again.
- Be like a real teacher: patient but insistent. Don't let mistakes slide. Make them practice until they get it right.
- Celebrate small victories! When they say something correctly, be enthusiastic.
- Use "hint" field often to explain grammar rules, pronunciation tips, or cultural context in ${nativeLang}.` : ''}`;
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
  const { uiLanguage, userName, userGender } = useUserStore();
  const t = useTranslation(uiLanguage);

  // Setup
  const [phase, setPhase] = useState<"setup" | "chat" | "vocab">("setup");
  const [mode, setMode] = useState<LearnMode>("conversation");
  const [nativeLang, setNativeLang] = useState(uiLanguage || "it");
  const [targetLang, setTargetLang] = useState(
    uiLanguage === "en" ? "it" : "en",
  );
  const [level, setLevel] = useState<Level>("base");
  const [topic, setTopic] = useState<Topic>("free");
  const [vocabCat, setVocabCat] = useState("numbers");

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [apiMessages, setApiMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true); // hands-free auto-listen

  // Vocabulary state
  const [vocabWords, setVocabWords] = useState<VocabWord[]>([]);
  const [vocabIndex, setVocabIndex] = useState(0);
  const [vocabState, setVocabState] = useState<VocabState>("loading");
  const [vocabFeedback, setVocabFeedback] = useState("");

  // Speed ref (can be changed by voice commands)
  const currentSpeedRef = useRef(LEVEL_SPEED[level]);

  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
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
  const silenceCyclesRef = useRef(0); // counts consecutive silence cycles for [NO_RESPONSE]
  const levelRef = useRef(level);
  const vocabRecorderRef = useRef<MediaRecorder | null>(null);

  // Keep refs in sync
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { currentSpeedRef.current = LEVEL_SPEED[level]; }, [level]);
  useEffect(() => { apiMessagesRef.current = apiMessages; }, [apiMessages]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { levelRef.current = level; }, [level]);

  // Auto-scroll only if user is near the bottom (not reading old messages)
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const threshold = 150; // px from bottom
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
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
          if (cancelledRef.current) { setChatState("idle"); return; }
          // Silence detected — increment counter
          silenceCyclesRef.current += 1;
          const isTeacherLevel = levelRef.current === "molto_base" || levelRef.current === "base";
          // After 2 consecutive silence cycles in teacher mode, send [NO_RESPONSE]
          if (isTeacherLevel && silenceCyclesRef.current >= 2) {
            silenceCyclesRef.current = 0;
            sendUserMessage("[NO_RESPONSE]");
            return;
          }
          // Otherwise just re-listen
          if (autoModeRef.current) startListening();
          else setChatState("idle");
          return;
        }
        // User spoke — reset silence counter
        silenceCyclesRef.current = 0;

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

    const isNoResponse = text === "[NO_RESPONSE]";
    const userMsg: ChatMessage = { role: "user", text };
    // Don't show [NO_RESPONSE] in chat UI
    if (!isNoResponse) {
      setMessages((prev) => [...prev, userMsg]);
    }

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

      const raw = await res.json();
      if (cancelledRef.current) return;

      // Normalize: sometimes model returns slightly different shapes
      const data: TutorResponse = {
        text: raw.text || "",
        translation: raw.translation || "",
        correction: raw.correction || undefined,
        hint: raw.hint || undefined,
      };

      // Skip empty responses
      if (!data.text && !data.translation) {
        if (autoModeRef.current) startListening();
        else setChatState("idle");
        return;
      }

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

    const systemPrompt = buildSystemPrompt(nativeLangLabel, targetLangLabel, level, topic, userName || undefined, userGender || undefined);
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

      const raw = await res.json();
      const data: TutorResponse = {
        text: raw.text || "",
        translation: raw.translation || "",
        correction: raw.correction || undefined,
        hint: raw.hint || undefined,
      };
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

  // ─── Vocabulary mode ──────────────────────────────────────────────────────

  const startVocab = async () => {
    prepareAudioForSafari();
    setPhase("vocab");
    setVocabState("loading");
    setVocabIndex(0);
    setVocabFeedback("");
    setError(null);

    try {
      const prompt = buildVocabPrompt(nativeLangLabel, targetLangLabel, vocabCat);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: "Generate the vocabulary list now." },
          ],
        }),
      });
      if (!res.ok) throw new Error("Failed to generate vocabulary");

      const data = await res.json();
      let words: VocabWord[];
      if (Array.isArray(data?.words)) {
        words = data.words;
      } else if (Array.isArray(data)) {
        words = data;
      } else if (typeof data.text === "string") {
        // Fallback: model returned text instead of structured JSON
        const match = data.text.match(/\[[\s\S]*\]/);
        if (match) words = JSON.parse(match[0]);
        else throw new Error("Could not parse vocabulary");
      } else {
        throw new Error("Invalid response");
      }

      if (!Array.isArray(words) || words.length === 0) throw new Error("Empty vocabulary");
      setVocabWords(words);
      setVocabState("ready");
    } catch (e: any) {
      setError(e.message || "Failed to generate vocabulary");
      setPhase("setup");
    }
  };

  const playVocabWord = async () => {
    const word = vocabWords[vocabIndex];
    if (!word) return;
    prepareAudioForSafari();
    try {
      await playTTS(word.word, undefined, 0.85, targetLang);
    } catch {}
  };

  const startVocabListening = async () => {
    setVocabState("listening");
    prepareAudioForSafari();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        audioCtx.close().catch(() => {});
        stream.getTracks().forEach((tr) => tr.stop());

        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size < 800) {
          setVocabState("ready");
          return;
        }

        setVocabState("evaluating");
        try {
          const text = await transcribeAudio(blob, targetLang);
          const spoken = text.toLowerCase().trim().replace(/[.!?,;:…"""'']+/g, "").trim();
          const expected = vocabWords[vocabIndex].word.toLowerCase().trim();

          const isCorrect =
            spoken === expected ||
            spoken.includes(expected) ||
            expected.includes(spoken) ||
            (spoken.length > 0 && normalizedSimilarity(spoken, expected) > 0.6);

          if (isCorrect) {
            setVocabState("correct");
            setVocabFeedback(t("vocabCorrect"));
          } else {
            setVocabState("wrong");
            setVocabFeedback(spoken ? `"${text.trim()}" — ${t("vocabTryAgain")}` : t("vocabTryAgain"));
            try {
              await playTTS(vocabWords[vocabIndex].word, undefined, 0.85, targetLang);
            } catch {}
          }
        } catch {
          setVocabState("ready");
        }
      };

      recorder.start();
      vocabRecorderRef.current = recorder;

      // Silence detection for single word
      const dataArray = new Uint8Array(analyser.fftSize);
      let silenceStart: number | null = null;
      let hasSpoken = false;

      const checkSilence = () => {
        if (recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms >= SILENCE_THRESHOLD) {
          hasSpoken = true;
          silenceStart = null;
        } else if (hasSpoken) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart > 1500) {
            recorder.stop();
            return;
          }
        }
        requestAnimationFrame(checkSilence);
      };
      checkSilence();

      // Max 5 seconds
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 5000);
    } catch {
      setVocabState("ready");
    }
  };

  const stopVocabListening = () => {
    if (vocabRecorderRef.current?.state === "recording") {
      vocabRecorderRef.current.stop();
    }
  };

  const nextVocabWord = () => {
    if (vocabIndex < vocabWords.length - 1) {
      setVocabIndex((prev) => prev + 1);
      setVocabState("ready");
      setVocabFeedback("");
    } else {
      setVocabState("complete");
    }
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
          <GraduationCap className="w-5 h-5 text-[#295BDB]" />
          <h1 className="text-lg font-bold flex-1">{t("learn")}</h1>
        </header>

        {/* Language selector (below header, like other pages) */}
        <div className="flex items-center gap-2 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]/50">
          <select
            value={nativeLang}
            onChange={(e) => setNativeLang(e.target.value)}
            className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm truncate"
          >
            <LanguageOptions />
          </select>
          <button onClick={swapLanguages} className="p-2 bg-[#123182] rounded-xl text-[#F4F4F4]/60 hover:bg-[#295BDB] hover:text-[#F4F4F4] transition-colors shrink-0">
            <ArrowRightLeft className="w-4 h-4" />
          </button>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="flex-1 min-w-0 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm truncate"
          >
            <LanguageOptions exclude={[nativeLang]} />
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 max-w-sm mx-auto w-full">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("conversation")}
              className={`flex-1 py-3 rounded-xl font-medium text-sm transition-colors border ${
                mode === "conversation"
                  ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                  : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"
              }`}
            >
              {t("learnModeConversation")}
            </button>
            <button
              onClick={() => setMode("vocabulary")}
              className={`flex-1 py-3 rounded-xl font-medium text-sm transition-colors border ${
                mode === "vocabulary"
                  ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                  : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"
              }`}
            >
              {t("learnModeVocabulary")}
            </button>
          </div>

          {mode === "conversation" ? (
            <>
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

              {/* Start conversation */}
              <button
                onClick={startLesson}
                className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-4 rounded-2xl transition-colors text-lg shadow-lg"
              >
                {t("learnStart")}
              </button>
            </>
          ) : (
            <>
              {/* Vocabulary categories */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/60 mb-2">{t("vocabCategory")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {VOCAB_CATS.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setVocabCat(cat.id)}
                      className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs font-medium transition-colors border ${
                        vocabCat === cat.id
                          ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                          : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                      }`}
                    >
                      <span className="text-lg">{cat.emoji}</span>
                      <span>{t(cat.labelKey as any)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Start vocabulary */}
              <button
                onClick={startVocab}
                className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-4 rounded-2xl transition-colors text-lg shadow-lg"
              >
                {t("learnStart")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: Vocabulary Phase ────────────────────────────────────────────

  const targetFlag = LANGUAGES.find((l) => l.code === targetLang)?.flag || "";

  if (phase === "vocab") {
    const currentWord = vocabWords[vocabIndex];
    const progress = vocabWords.length > 0 ? `${vocabIndex + 1} / ${vocabWords.length}` : "";

    return (
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
        <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
          <button onClick={() => setPhase("setup")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-sm font-bold">{targetFlag} {t("learnModeVocabulary")}</h1>
            <p className="text-xs text-[#F4F4F4]/40">{t(VOCAB_CATS.find((c) => c.id === vocabCat)?.labelKey as any)} · {progress}</p>
          </div>
        </header>

        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3 shrink-0">
            <p className="text-sm text-red-400 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 text-xs">✕</button>
          </div>
        )}

        {vocabState === "loading" ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#295BDB]" />
          </div>
        ) : vocabState === "complete" ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
            <div className="text-6xl">🎉</div>
            <p className="text-xl font-bold text-center">{t("vocabComplete")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setPhase("setup")}
                className="px-6 py-3 bg-[#123182] rounded-xl text-[#F4F4F4]/80 hover:bg-[#123182]/80 transition-colors font-medium"
              >
                {t("vocabTryAnother")}
              </button>
              <button
                onClick={() => { setVocabIndex(0); setVocabState("ready"); setVocabFeedback(""); }}
                className="px-6 py-3 bg-[#295BDB] rounded-xl text-[#F4F4F4] hover:bg-[#295BDB]/80 transition-colors font-medium flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5">
              {/* Progress bar */}
              <div className="w-full max-w-xs bg-[#123182] rounded-full h-1.5">
                <div
                  className="bg-[#295BDB] h-1.5 rounded-full transition-all"
                  style={{ width: `${((vocabIndex + 1) / vocabWords.length) * 100}%` }}
                />
              </div>

              {/* Word card */}
              <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-3xl p-8 w-full max-w-xs text-center space-y-3">
                <p className="text-4xl font-bold leading-tight">{currentWord?.word}</p>
                <p className="text-lg text-[#F4F4F4]/60">{currentWord?.translation}</p>
                {currentWord?.phonetic && (
                  <p className="text-sm text-[#295BDB] italic">{currentWord.phonetic}</p>
                )}
              </div>

              {/* Listen button */}
              <button
                onClick={playVocabWord}
                className="flex items-center gap-2 px-6 py-3 bg-[#123182] rounded-xl text-[#F4F4F4]/80 hover:bg-[#123182]/80 transition-colors"
              >
                <Volume2 className="w-5 h-5" />
                {t("vocabListen")}
              </button>

              {/* Feedback area */}
              {vocabState === "correct" && (
                <div className="bg-green-500/20 border border-green-500/30 rounded-xl px-5 py-3 text-green-400 font-medium text-center w-full max-w-xs">
                  {vocabFeedback}
                </div>
              )}
              {vocabState === "wrong" && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl px-5 py-3 text-red-400 font-medium text-center text-sm w-full max-w-xs">
                  {vocabFeedback}
                </div>
              )}
              {vocabState === "evaluating" && (
                <div className="flex items-center gap-2 text-[#F4F4F4]/40">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{t("learnTranscribing")}</span>
                </div>
              )}
            </div>

            {/* Bottom bar */}
            <div className="shrink-0 border-t border-[#FFFFFF14] bg-[#0E2666] p-4">
              <p className="text-xs text-[#F4F4F4]/40 text-center mb-3">
                {vocabState === "listening" ? t("learnListening") : t("vocabTapToSpeak")}
              </p>
              <div className="flex items-center justify-center gap-4">
                {/* Back */}
                <button
                  onClick={() => { setVocabIndex(Math.max(0, vocabIndex - 1)); setVocabState("ready"); setVocabFeedback(""); }}
                  disabled={vocabIndex === 0 || vocabState === "listening" || vocabState === "evaluating"}
                  className="flex items-center gap-1.5 px-4 py-3 bg-[#123182] rounded-2xl text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#123182]/80 transition-colors disabled:opacity-30 text-sm font-medium"
                >
                  <ChevronLeft className="w-5 h-5" />
                  {t("vocabPrev")}
                </button>

                {/* Mic */}
                <button
                  onClick={vocabState === "listening" ? stopVocabListening : startVocabListening}
                  disabled={vocabState === "evaluating"}
                  className={`p-5 rounded-full transition-all ${
                    vocabState === "listening"
                      ? "bg-red-500 text-[#F4F4F4] shadow-lg shadow-red-500/30 animate-pulse"
                      : "bg-[#295BDB] text-[#F4F4F4] hover:bg-[#295BDB]/80"
                  } disabled:opacity-30`}
                >
                  {vocabState === "listening" ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                </button>

                {/* Next */}
                <button
                  onClick={nextVocabWord}
                  disabled={vocabState === "listening" || vocabState === "evaluating"}
                  className="flex items-center gap-1.5 px-4 py-3 bg-[#123182] rounded-2xl text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#123182]/80 transition-colors disabled:opacity-30 text-sm font-medium"
                >
                  {t("vocabNext")}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── Render: Chat Phase ───────────────────────────────────────────────────
  const { label: statusLabel, color: statusColor, pulse: statusPulse } = statusConfig[chatState];

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      {/* Header — fixed at top */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0 z-10">
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
        <button
          onClick={async () => {
            const text = messages
              .map((msg) => {
                const label = msg.role === "tutor" ? "Tutor" : t("you");
                const line = `[${label}] ${msg.text}`;
                return msg.translation ? `${line}\n  → ${msg.translation}` : line;
              })
              .join("\n\n");
            if (navigator.share) {
              try {
                await navigator.share({ title: `PolyGlot - ${t("learn")}`, text });
              } catch {}
            }
          }}
          disabled={messages.length === 0}
          className={`p-2 rounded-lg transition-colors ${messages.length > 0 ? "text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]" : "text-[#F4F4F4]/20"}`}
        >
          <Upload className="w-5 h-5" />
        </button>
        <button onClick={resetLesson} className="p-2 rounded-lg text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]">
          <RotateCcw className="w-5 h-5" />
        </button>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3 shrink-0">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 text-xs">✕</button>
        </div>
      )}

      {/* Messages — only this area scrolls */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {/* Voice commands tip card */}
        <div className="bg-[#123182]/50 border border-[#FFFFFF14] rounded-2xl p-3 flex items-start gap-2.5">
          <Mic className="w-4 h-4 text-[#295BDB] shrink-0 mt-0.5" />
          <div className="text-xs text-[#F4F4F4]/50 leading-relaxed space-y-0.5">
            <p className="text-[#F4F4F4]/70 font-medium">{t("learnVoiceCommandsTitle")}</p>
            <p>🔁 <b>Ripeti / Repeat</b> · 🐢 <b>Più lento / Slower</b> · 🐇 <b>Più veloce / Faster</b> · 🛑 <b>Stop / Ferma</b> · ❓ <b>Aiuto / Help</b></p>
          </div>
        </div>

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
