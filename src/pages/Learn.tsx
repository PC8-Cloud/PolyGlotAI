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
  Link2,
  Play,
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { playTTS, prepareAudioForSafari, muteAudio, getApiErrorMessage, transcribeAudio, suspendAudioForMic, translateText, analyzeImage, transcribeMediaWithTimestamps, textToSpeech } from "../lib/openai";
import { extractTextFromFile } from "../lib/file-reader";
import { readClipboardText } from "../lib/clipboard";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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
type LearnMode = "conversation" | "vocabulary" | "text_translate" | "video_translate";
type VocabState = "loading" | "ready" | "listening" | "evaluating" | "correct" | "wrong" | "complete";

interface VocabWord {
  word: string;
  translation: string;
  phonetic: string;
}

interface VideoDubSegment {
  id: string;
  start: number;
  end: number;
  sourceText: string;
  translatedText: string;
  audioUrl: string;
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
const SILENCE_TIMEOUT = 1.4;
const SILENCE_THRESHOLD = 0.018; // audio level below this = silence
const VOICE_ACTIVITY_THRESHOLD = 0.03;
const VOICE_ACTIVITY_FRAMES = 2;
const NO_SPEECH_TIMEOUT_MS = 3500;
const VOCAB_SILENCE_TIMEOUT_MS = 1700;
const VOCAB_SILENCE_THRESHOLD = 0.02;
const VOCAB_VOICE_ACTIVITY_THRESHOLD = 0.04;
const VOCAB_VOICE_ACTIVITY_FRAMES = 2;
const VOCAB_NO_SPEECH_TIMEOUT_MS = 3500;
const SCANNED_PDF_MAX_PAGES = 4;
const VIDEO_MAX_DURATION_SEC = 15 * 60;
const VIDEO_MAX_SEGMENTS = 120;

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

function buildLessonKickoffPrompt(nativeLang: string, targetLang: string, level: Level, topic: Topic, studentName?: string): string {
  return `Start the spoken lesson now.
- Greet ${studentName || "the student"} naturally
- Speak in ${targetLang}
- Put the translation in ${nativeLang}
- Keep the first tutor turn short and easy to answer
- Ask exactly one question to begin
- Topic: ${topic}
- Level: ${level}`;
}

function normalizeTutorResponse(raw: any): TutorResponse {
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  const translation = typeof raw?.translation === "string" ? raw.translation.trim() : "";
  const correction = typeof raw?.correction === "string" && raw.correction.trim() ? raw.correction.trim() : undefined;
  const hint = typeof raw?.hint === "string" && raw.hint.trim() ? raw.hint.trim() : undefined;

  return { text, translation, correction, hint };
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
  const [textTranslateInput, setTextTranslateInput] = useState("");
  const [textTranslateOutput, setTextTranslateOutput] = useState("");
  const [textTranslateBusy, setTextTranslateBusy] = useState(false);
  const [videoLinkInput, setVideoLinkInput] = useState("");
  const [videoSourceUrl, setVideoSourceUrl] = useState<string | null>(null);
  const [videoSourceName, setVideoSourceName] = useState("");
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [videoSegments, setVideoSegments] = useState<VideoDubSegment[]>([]);
  const [videoDetectedLanguage, setVideoDetectedLanguage] = useState("");
  const [videoSubtitleIndex, setVideoSubtitleIndex] = useState(-1);
  const [videoDubActive, setVideoDubActive] = useState(false);

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
  const chatRequestIdRef = useRef(0);
  const vocabAnimRef = useRef<number>(0);
  const vocabMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const wakeLockReleaseHandlerRef = useRef<(() => void) | null>(null);
  const keepAliveCtxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);
  const phaseRef = useRef<"setup" | "chat" | "vocab">("setup");
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const activeDubAudioRef = useRef<HTMLAudioElement | null>(null);
  const dubTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { currentSpeedRef.current = LEVEL_SPEED[level]; }, [level]);
  useEffect(() => { apiMessagesRef.current = apiMessages; }, [apiMessages]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const startKeepAliveFallback = useCallback(async () => {
    if (keepAliveCtxRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 30;
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      await ctx.resume();
      keepAliveCtxRef.current = ctx;
      keepAliveOscRef.current = oscillator;
    } catch {}
  }, []);

  const stopKeepAliveFallback = useCallback(() => {
    try {
      keepAliveOscRef.current?.stop();
    } catch {}
    keepAliveOscRef.current = null;
    if (keepAliveCtxRef.current) {
      keepAliveCtxRef.current.close().catch(() => {});
      keepAliveCtxRef.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      const active =
        phaseRef.current === "chat" ||
        phaseRef.current === "vocab" ||
        videoProcessing ||
        videoDubActive;
      if (!active) return;
      if (!("wakeLock" in navigator)) {
        await startKeepAliveFallback();
        return;
      }
      if (wakeLockRef.current) return;
      const lock = await (navigator as any).wakeLock.request("screen");
      const handleRelease = () => {
        wakeLockRef.current = null;
        if (phaseRef.current === "chat" || phaseRef.current === "vocab") {
          if (document.visibilityState === "visible") {
            void acquireWakeLock();
          } else {
            void startKeepAliveFallback();
          }
        }
      };
      lock.addEventListener?.("release", handleRelease);
      wakeLockReleaseHandlerRef.current = handleRelease;
      wakeLockRef.current = lock;
      stopKeepAliveFallback();
    } catch {
      await startKeepAliveFallback();
    }
  }, [startKeepAliveFallback, stopKeepAliveFallback, videoDubActive, videoProcessing]);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      if (wakeLockReleaseHandlerRef.current) {
        wakeLockRef.current.removeEventListener?.("release", wakeLockReleaseHandlerRef.current);
      }
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    wakeLockReleaseHandlerRef.current = null;
    stopKeepAliveFallback();
  }, [stopKeepAliveFallback]);

  // Cleanup on unmount — stop all audio and recording when leaving the page
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopListening();
      stopVocabListening();
      releaseWakeLock();
      muteAudio();
      // Also stop any HTML5 audio elements
      document.querySelectorAll("audio").forEach((a) => { a.pause(); a.currentTime = 0; });
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    if (phase === "chat" || phase === "vocab" || videoProcessing || videoDubActive) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [phase, videoProcessing, videoDubActive, acquireWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        (phase === "chat" || phase === "vocab" || videoProcessing || videoDubActive)
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [phase, videoProcessing, videoDubActive, acquireWakeLock]);

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

  const getUiLabel = (it: string, en: string) =>
    String(uiLanguage).toLowerCase().startsWith("it") ? it : en;

  const stopDubPlayback = useCallback(() => {
    if (dubTimerRef.current) {
      clearInterval(dubTimerRef.current);
      dubTimerRef.current = null;
    }
    if (activeDubAudioRef.current) {
      activeDubAudioRef.current.pause();
      activeDubAudioRef.current.currentTime = 0;
      activeDubAudioRef.current = null;
    }
    setVideoDubActive(false);
  }, []);

  const clearVideoState = useCallback(() => {
    stopDubPlayback();
    setVideoSubtitleIndex(-1);
    setVideoSegments((prev) => {
      prev.forEach((s) => {
        try { URL.revokeObjectURL(s.audioUrl); } catch {}
      });
      return [];
    });
    setVideoDetectedLanguage("");
    if (videoObjectUrlRef.current) {
      try { URL.revokeObjectURL(videoObjectUrlRef.current); } catch {}
      videoObjectUrlRef.current = null;
    }
    setVideoSourceUrl(null);
    setVideoSourceName("");
  }, [stopDubPlayback]);

  const translatePlainText = useCallback(async (text: string) => {
    const source = text.trim();
    if (!source) return;
    setTextTranslateBusy(true);
    setError(null);
    try {
      const result = await translateText(source, nativeLang, [targetLang], { mode: "general" });
      const translated = result[targetLang] || "";
      if (!translated) throw new Error("empty_translation");
      setTextTranslateOutput(translated);
    } catch (e: any) {
      const { fallback } = getApiErrorMessage(e);
      setError((t as any).genericApiError || fallback);
    } finally {
      setTextTranslateBusy(false);
    }
  }, [nativeLang, targetLang, t]);

  const ocrPdfWithVision = useCallback(async (file: File) => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pagesToScan = Math.min(pdf.numPages, SCANNED_PDF_MAX_PAGES);
    const extractedParts: string[] = [];
    const translatedParts: string[] = [];

    for (let i = 1; i <= pagesToScan; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const base64 = dataUrl.split(",")[1];
      if (!base64) continue;

      const analysis = await analyzeImage(base64, targetLangLabel, nativeLangLabel);
      const extracted = (analysis.extractedText || analysis.objectName || "").trim();
      const translated = (analysis.translatedText || analysis.translation || "").trim();
      if (extracted) extractedParts.push(extracted);
      if (translated) translatedParts.push(translated);
    }

    return {
      extractedText: extractedParts.join("\n\n"),
      translatedText: translatedParts.join("\n\n"),
    };
  }, [nativeLangLabel, targetLangLabel]);

  const handleTextTranslatePaste = useCallback(async () => {
    try {
      const pasted = await readClipboardText({ manualPrompt: t("loadTextPaste") });
      if (!pasted.trim()) return;
      setTextTranslateInput(pasted.trim());
      await translatePlainText(pasted);
    } catch {
      setError(getUiLabel("Accesso appunti negato", "Clipboard access denied"));
    }
  }, [getUiLabel, t, translatePlainText]);

  const handleTextTranslateFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTextTranslateBusy(true);
    setError(null);
    try {
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);
      if (isImage) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("image_read_failed"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1];
        if (!base64) throw new Error("image_parse_failed");
        const analysis = await analyzeImage(base64, targetLangLabel, nativeLangLabel);
        const extracted = (analysis.extractedText || analysis.objectName || "").trim();
        const translated = (analysis.translatedText || analysis.translation || "").trim();
        setTextTranslateInput(extracted);
        setTextTranslateOutput(translated);
      } else {
        let extracted = (await extractTextFromFile(file)).trim();
        if (extracted) {
          setTextTranslateInput(extracted);
          const result = await translateText(extracted, nativeLang, [targetLang], { mode: "general" });
          setTextTranslateOutput(result[targetLang] || "");
        } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const scanned = await ocrPdfWithVision(file);
          if (!scanned.extractedText && !scanned.translatedText) {
            throw new Error("ocr_empty");
          }
          setTextTranslateInput(scanned.extractedText);
          setTextTranslateOutput(scanned.translatedText);
        } else {
          throw new Error("empty_text");
        }
      }
    } catch (e: any) {
      const known = String(e?.message || "");
      if (known === "empty_text" || known === "ocr_empty") {
        setError(getUiLabel(
          "Nessun testo rilevato nel file. Prova con un file più leggibile.",
          "No readable text found in the file. Try a clearer file."
        ));
      } else {
        const { fallback } = getApiErrorMessage(e);
        setError((t as any).genericApiError || fallback);
      }
    } finally {
      setTextTranslateBusy(false);
      if (textFileInputRef.current) textFileInputRef.current.value = "";
    }
  }, [getUiLabel, nativeLang, nativeLangLabel, ocrPdfWithVision, t, targetLang, targetLangLabel]);

  useEffect(() => {
    return () => {
      clearVideoState();
    };
  }, [clearVideoState]);

  const mergeTranscribedSegments = useCallback((segments: Array<{ start: number; end: number; text: string }>) => {
    const normalized = segments
      .map((s) => ({
        start: Number.isFinite(s.start) ? s.start : 0,
        end: Number.isFinite(s.end) ? s.end : 0,
        text: (s.text || "").trim(),
      }))
      .filter((s) => s.text);

    const merged: Array<{ start: number; end: number; text: string }> = [];
    for (const seg of normalized) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push({ ...seg });
        continue;
      }
      const charLen = prev.text.length;
      const gap = Math.max(0, seg.start - prev.end);
      const canMerge = charLen < 170 && gap <= 1.2 && (seg.end - prev.start) <= 10;
      if (canMerge) {
        prev.text = `${prev.text} ${seg.text}`.trim();
        prev.end = Math.max(prev.end, seg.end);
      } else {
        merged.push({ ...seg });
      }
    }
    return merged.slice(0, VIDEO_MAX_SEGMENTS);
  }, []);

  const buildDubbedSegments = useCallback(async (
    rawSegments: Array<{ start: number; end: number; text: string }>,
    sourceLanguage: string,
  ): Promise<VideoDubSegment[]> => {
    const merged = mergeTranscribedSegments(rawSegments);
    const out: VideoDubSegment[] = [];

    for (let i = 0; i < merged.length; i++) {
      const seg = merged[i];
      const translatedObj = await translateText(seg.text, sourceLanguage, [targetLang], { mode: "general" });
      const translatedText = (translatedObj[targetLang] || "").trim();
      if (!translatedText) continue;
      const audioBuffer = await textToSpeech(translatedText, undefined, 1.0);
      const audioBlob = new Blob([audioBuffer]);
      const audioUrl = URL.createObjectURL(audioBlob);
      out.push({
        id: `seg-${i}`,
        start: seg.start,
        end: seg.end > seg.start ? seg.end : seg.start + 2.5,
        sourceText: seg.text,
        translatedText,
        audioUrl,
      });
    }

    return out;
  }, [mergeTranscribedSegments, targetLang]);

  const processVideoBlob = useCallback(async (blob: Blob, sourceName: string) => {
    setVideoProcessing(true);
    setError(null);
    stopDubPlayback();
    setVideoSubtitleIndex(-1);

    setVideoSegments((prev) => {
      prev.forEach((s) => {
        try { URL.revokeObjectURL(s.audioUrl); } catch {}
      });
      return [];
    });

    try {
      const objectUrl = URL.createObjectURL(blob);
      const durationSec = await new Promise<number>((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0);
        v.onerror = () => resolve(0);
        v.src = objectUrl;
      });

      if (durationSec > VIDEO_MAX_DURATION_SEC) {
        throw new Error("video_too_long");
      }

      if (videoObjectUrlRef.current) {
        try { URL.revokeObjectURL(videoObjectUrlRef.current); } catch {}
      }
      videoObjectUrlRef.current = objectUrl;
      setVideoSourceUrl(objectUrl);
      setVideoSourceName(sourceName);

      const transcription = await transcribeMediaWithTimestamps(blob);
      const sourceLanguage = (transcription.language || nativeLang || "auto").trim();
      setVideoDetectedLanguage(sourceLanguage);

      const rawSegments = transcription.segments.length > 0
        ? transcription.segments
        : [{ start: 0, end: Math.max(3, Math.min(8, durationSec || 5)), text: transcription.text || "" }];

      if (!rawSegments.some((s) => s.text.trim())) {
        throw new Error("video_no_speech");
      }

      const dubbedSegments = await buildDubbedSegments(rawSegments, sourceLanguage);
      if (dubbedSegments.length === 0) {
        throw new Error("video_translate_empty");
      }
      setVideoSegments(dubbedSegments);
    } catch (e: any) {
      const code = String(e?.message || "");
      if (code === "video_too_long") {
        setError(getUiLabel(
          "Video troppo lungo. Limite consigliato: 15 minuti.",
          "Video too long. Recommended limit: 15 minutes."
        ));
      } else if (code === "video_no_speech") {
        setError(getUiLabel(
          "Non ho rilevato parlato nel video.",
          "No speech detected in the video."
        ));
      } else if (code === "video_translate_empty") {
        setError(getUiLabel(
          "Trascrizione rilevata ma traduzione audio non disponibile.",
          "Transcription found but translated audio is not available."
        ));
      } else {
        const { fallback } = getApiErrorMessage(e);
        setError((t as any).genericApiError || fallback);
      }
    } finally {
      setVideoProcessing(false);
    }
  }, [buildDubbedSegments, getUiLabel, nativeLang, stopDubPlayback, t]);

  const handleVideoFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await processVideoBlob(file, file.name || "video");
    } finally {
      if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    }
  }, [processVideoBlob]);

  const handleVideoLink = useCallback(async () => {
    const url = videoLinkInput.trim();
    if (!url) return;
    setVideoProcessing(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("video_link_fetch_failed");
      const blob = await res.blob();
      await processVideoBlob(blob, url);
    } catch {
      setError(getUiLabel(
        "Link video non supportato o bloccato (CORS). Usa un link diretto .mp4/.webm oppure carica il file.",
        "Video link unsupported or blocked (CORS). Use a direct .mp4/.webm link or upload the file."
      ));
    } finally {
      setVideoProcessing(false);
    }
  }, [getUiLabel, processVideoBlob, videoLinkInput]);

  const startDubbedPlayback = useCallback(async () => {
    const video = videoElementRef.current;
    if (!video || videoSegments.length === 0) return;

    stopDubPlayback();
    setVideoDubActive(true);
    setVideoSubtitleIndex(-1);
    video.muted = true;
    video.currentTime = 0;
    try {
      await video.play();
    } catch {
      setVideoDubActive(false);
      return;
    }

    dubTimerRef.current = setInterval(() => {
      const currentTime = video.currentTime || 0;
      const idx = videoSegments.findIndex((s) => currentTime >= s.start && currentTime < s.end);
      setVideoSubtitleIndex(idx);

      if (idx >= 0) {
        const seg = videoSegments[idx];
        const active = activeDubAudioRef.current as any;
        if (!active || active.__segId !== seg.id) {
          if (activeDubAudioRef.current) {
            activeDubAudioRef.current.pause();
            activeDubAudioRef.current.currentTime = 0;
          }
          const audio = new Audio(seg.audioUrl) as any;
          audio.__segId = seg.id;
          activeDubAudioRef.current = audio;
          audio.play().catch(() => {});
        }
      }

      if (video.ended) {
        stopDubPlayback();
      }
    }, 120);
  }, [stopDubPlayback, videoSegments]);

  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    const onPause = () => {
      if (!video.ended) stopDubPlayback();
    };
    const onSeeked = () => {
      if (videoDubActive && activeDubAudioRef.current) {
        activeDubAudioRef.current.pause();
        activeDubAudioRef.current.currentTime = 0;
        activeDubAudioRef.current = null;
      }
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [stopDubPlayback, videoDubActive]);

  // ─── Silence detection ─────────────────────────────────────────────────────

  const startSilenceDetection = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.fftSize);
    let silenceStart: number | null = null;
    let speechFrames = 0;
    let hasSpeechStarted = false;
    const startTime = Date.now();

    const check = () => {
      analyser.getByteTimeDomainData(dataArray);
      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms >= VOICE_ACTIVITY_THRESHOLD) {
        speechFrames += 1;
        if (speechFrames >= VOICE_ACTIVITY_FRAMES) {
          hasSpeechStarted = true;
        }
      } else {
        speechFrames = 0;
      }

      if (hasSpeechStarted) {
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
      } else if ((Date.now() - startTime) > NO_SPEECH_TIMEOUT_MS) {
        stopListening();
        return;
      }

      animFrameRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);

  // ─── Start listening ───────────────────────────────────────────────────────

  /** Pick a supported MIME type for MediaRecorder (Safari/iOS compatibility) */
  const getRecorderMimeType = (): string => {
    if (typeof MediaRecorder === "undefined") return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
    if (MediaRecorder.isTypeSupported("audio/aac")) return "audio/aac";
    if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
    return "";
  };

  const startListening = useCallback(async () => {
    if (cancelledRef.current) return;
    if (mediaRecorderRef.current?.state === "recording") return;
    console.log("[Learn] startListening");
    suspendAudioForMic();
    setChatState("listening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for silence detection
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start recording
      const mimeType = getRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current);
        audioCtx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });
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
    console.log("[Learn] stopListening");
    cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ─── Send user message & get tutor reply ───────────────────────────────────

  const sendUserMessage = useCallback(async (text: string) => {
    if (!text || cancelledRef.current) return;

    prepareAudioForSafari();
    muteAudio();
    setInput("");
    setError(null);
    const requestId = ++chatRequestIdRef.current;

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
      if (cancelledRef.current || requestId !== chatRequestIdRef.current) return;

      const data = normalizeTutorResponse(raw);

      // Skip empty responses
      if (!data.text && !data.translation) {
        setError(t("genericApiError"));
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
        console.log("[Learn] play tutor TTS", { textPreview: data.text.slice(0, 60), targetLang });
        if (data.text) {
          await playTTS(data.text, undefined, currentSpeedRef.current, targetLang);
        }
      } catch (e) {
        console.error("TTS error:", e);
      }

      if (cancelledRef.current || requestId !== chatRequestIdRef.current) return;

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
    muteAudio();
    cancelledRef.current = false;
    const requestId = ++chatRequestIdRef.current;

    const systemPrompt = buildSystemPrompt(nativeLangLabel, targetLangLabel, level, topic, userName || undefined, userGender || undefined);
    const kickoffPrompt = buildLessonKickoffPrompt(nativeLangLabel, targetLangLabel, level, topic, userName || undefined);
    const initMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: kickoffPrompt },
    ];

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
      if (cancelledRef.current || requestId !== chatRequestIdRef.current) return;

      const data = normalizeTutorResponse(raw);
      if (!data.text && !data.translation) {
        throw new Error("Empty tutor response");
      }

      const tutorMsg: ChatMessage = {
        role: "tutor",
        text: data.text,
        translation: data.translation,
        correction: data.correction,
        hint: data.hint || undefined,
      };

      const fullApiMessages = [...initMessages, { role: "assistant" as const, content: JSON.stringify(data) }];
      setMessages([tutorMsg]);
      setApiMessages(fullApiMessages);

      // Speak, then auto-listen
      setChatState("speaking");
      try {
        if (data.text) {
          await playTTS(data.text, undefined, currentSpeedRef.current, targetLang);
        }
      } catch (e) {
        console.error("TTS error:", e);
      }

      if (autoModeRef.current && !cancelledRef.current && requestId === chatRequestIdRef.current) {
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
    chatRequestIdRef.current += 1;
    stopListening();
    stopVocabListening();
    releaseWakeLock();
    muteAudio();
    document.querySelectorAll("audio").forEach((a) => { a.pause(); a.currentTime = 0; });
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
    chatRequestIdRef.current += 1;
    setAutoMode(false);
    stopListening();
    muteAudio();
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
    muteAudio();
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
    acquireWakeLock();
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
      releaseWakeLock();
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
    console.log("[Learn] startVocabListening");
    if (vocabRecorderRef.current?.state === "recording") return;
    setVocabState("listening");
    setError(null);
    prepareAudioForSafari();
    suspendAudioForMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const mimeType = getRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      let noSpeechDetected = false;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        if (vocabAnimRef.current) cancelAnimationFrame(vocabAnimRef.current);
        if (vocabMaxTimerRef.current) {
          clearTimeout(vocabMaxTimerRef.current);
          vocabMaxTimerRef.current = null;
        }
        vocabRecorderRef.current = null;
        audioCtx.close().catch(() => {});
        stream.getTracks().forEach((tr) => tr.stop());

        if (noSpeechDetected) {
          setVocabState("ready");
          return;
        }

        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: blobType });
        if (blob.size < 700) {
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
      let hasSpeechStarted = false;
      let speechFrames = 0;
      const listenStart = Date.now();

      const checkSilence = () => {
        if (recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms >= VOCAB_VOICE_ACTIVITY_THRESHOLD) {
          speechFrames += 1;
          if (speechFrames >= VOCAB_VOICE_ACTIVITY_FRAMES) {
            hasSpeechStarted = true;
          }
        } else {
          speechFrames = 0;
        }

        if (hasSpeechStarted) {
          if (rms < VOCAB_SILENCE_THRESHOLD) {
            if (!silenceStart) silenceStart = Date.now();
            else if (Date.now() - silenceStart > VOCAB_SILENCE_TIMEOUT_MS) {
              recorder.stop();
              return;
            }
          } else {
            silenceStart = null;
          }
        } else if (Date.now() - listenStart > VOCAB_NO_SPEECH_TIMEOUT_MS) {
          noSpeechDetected = true;
          recorder.stop();
          return;
        }
        vocabAnimRef.current = requestAnimationFrame(checkSilence);
      };
      checkSilence();

      // Max 5 seconds
      vocabMaxTimerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 5000);
    } catch {
      setVocabState("ready");
    }
  };

  const stopVocabListening = () => {
    console.log("[Learn] stopVocabListening");
    if (vocabAnimRef.current) cancelAnimationFrame(vocabAnimRef.current);
    if (vocabMaxTimerRef.current) {
      clearTimeout(vocabMaxTimerRef.current);
      vocabMaxTimerRef.current = null;
    }
    if (vocabRecorderRef.current?.state === "recording") {
      vocabRecorderRef.current.stop();
    }
    vocabRecorderRef.current = null;
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
          <button onClick={() => { muteAudio(); navigate("/"); }} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
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
          <div className="grid grid-cols-2 gap-2">
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
            <button
              onClick={() => setMode("text_translate")}
              className={`flex-1 py-3 rounded-xl font-medium text-sm transition-colors border ${
                mode === "text_translate"
                  ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                  : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"
              }`}
            >
              {getUiLabel("Traduci testo", "Translate text")}
            </button>
            <button
              onClick={() => setMode("video_translate")}
              className={`flex-1 py-3 rounded-xl font-medium text-sm transition-colors border ${
                mode === "video_translate"
                  ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                  : "bg-[#0E2666] border-[#FFFFFF14] text-[#F4F4F4]/60"
              }`}
            >
              {getUiLabel("Traduci video", "Translate video")}
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
          ) : mode === "vocabulary" ? (
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
          ) : mode === "text_translate" ? (
            <>
              <input
                ref={textFileInputRef}
                type="file"
                accept=".txt,.pdf,.md,.text,.docx,.doc,.png,.jpg,.jpeg,.webp,.bmp,.gif"
                onChange={handleTextTranslateFile}
                className="hidden"
              />

              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/60 mb-2">
                  {getUiLabel("Testo da tradurre", "Text to translate")}
                </label>
                <textarea
                  value={textTranslateInput}
                  onChange={(e) => setTextTranslateInput(e.target.value)}
                  placeholder={getUiLabel("Incolla qui il testo o importa un file…", "Paste text here or import a file…")}
                  className="w-full min-h-[130px] bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] text-sm leading-relaxed"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTextTranslatePaste}
                  disabled={textTranslateBusy}
                  className="flex-1 py-3 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#123182]/80 disabled:opacity-40 transition-colors text-sm font-medium"
                >
                  {getUiLabel("Incolla", "Paste")}
                </button>
                <button
                  onClick={() => textFileInputRef.current?.click()}
                  disabled={textTranslateBusy}
                  className="flex-1 py-3 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#123182]/80 disabled:opacity-40 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {getUiLabel("Sfoglia", "Browse")}
                </button>
              </div>

              <button
                onClick={() => translatePlainText(textTranslateInput)}
                disabled={!textTranslateInput.trim() || textTranslateBusy}
                className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 text-[#F4F4F4] font-bold py-4 rounded-2xl transition-colors text-lg shadow-lg"
              >
                {textTranslateBusy ? "..." : getUiLabel("Traduci testo", "Translate text")}
              </button>

              {textTranslateOutput && (
                <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4 space-y-2">
                  <p className="text-xs text-[#F4F4F4]/50 uppercase tracking-wide">{getUiLabel("Traduzione", "Translation")}</p>
                  <p className="text-[#295BDB] text-base leading-relaxed whitespace-pre-wrap">{textTranslateOutput}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <input
                ref={videoFileInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                onChange={handleVideoFile}
                className="hidden"
              />

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#F4F4F4]/60">
                  {getUiLabel("Link video", "Video link")}
                </label>
                <div className="flex gap-2">
                  <input
                    value={videoLinkInput}
                    onChange={(e) => setVideoLinkInput(e.target.value)}
                    placeholder={getUiLabel("Incolla un link diretto .mp4/.webm", "Paste a direct .mp4/.webm link")}
                    className="flex-1 bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB]"
                  />
                  <button
                    onClick={handleVideoLink}
                    disabled={!videoLinkInput.trim() || videoProcessing}
                    className="px-3 py-2.5 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#123182]/80 disabled:opacity-40 transition-colors"
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => videoFileInputRef.current?.click()}
                disabled={videoProcessing}
                className="w-full py-3 rounded-xl bg-[#123182] text-[#F4F4F4]/80 hover:bg-[#123182]/80 disabled:opacity-40 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {getUiLabel("Carica video", "Upload video")}
              </button>

              {videoSourceUrl && (
                <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-3 space-y-3">
                  <p className="text-xs text-[#F4F4F4]/45 truncate">
                    {videoSourceName}
                  </p>
                  {videoDetectedLanguage && (
                    <p className="text-xs text-[#F4F4F4]/45">
                      {getUiLabel("Lingua rilevata", "Detected language")}: {videoDetectedLanguage}
                    </p>
                  )}
                  <video
                    ref={videoElementRef}
                    src={videoSourceUrl}
                    controls
                    playsInline
                    className="w-full rounded-xl bg-black/30"
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={startDubbedPlayback}
                      disabled={videoProcessing || videoSegments.length === 0}
                      className="flex-1 py-2.5 rounded-xl bg-[#295BDB] text-[#F4F4F4] hover:bg-[#295BDB]/80 disabled:opacity-40 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      {getUiLabel("Riproduci doppiato", "Play dubbed")}
                    </button>
                    <button
                      onClick={stopDubPlayback}
                      disabled={!videoDubActive}
                      className="px-4 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 transition-colors text-sm font-medium"
                    >
                      {getUiLabel("Ferma", "Stop")}
                    </button>
                  </div>

                  <div className="bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-3 min-h-[84px] space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-[#F4F4F4]/40">
                      {getUiLabel("Sottotitoli tradotti", "Translated subtitles")}
                    </p>
                    {videoSubtitleIndex >= 0 && videoSegments[videoSubtitleIndex] ? (
                      <>
                        <p className="text-xs text-[#F4F4F4]/45 whitespace-pre-wrap">
                          {videoSegments[videoSubtitleIndex].sourceText}
                        </p>
                        <p className="text-sm text-[#295BDB] font-semibold whitespace-pre-wrap">
                          {videoSegments[videoSubtitleIndex].translatedText}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-[#F4F4F4]/40">
                        {videoSegments.length > 0
                          ? getUiLabel("Premi 'Riproduci doppiato' per iniziare.", "Tap 'Play dubbed' to start.")
                          : getUiLabel("Elaborazione in corso o nessun segmento disponibile.", "Processing or no segments available.")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {videoProcessing && (
                <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-[#295BDB]" />
                  <p className="text-sm text-[#F4F4F4]/70">
                    {getUiLabel("Trascrivo, traduco e creo il doppiaggio…", "Transcribing, translating, and generating dubbing…")}
                  </p>
                </div>
              )}
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
