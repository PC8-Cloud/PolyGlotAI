// ─── Offline storage utilities ──────────────────────────────────────────────

const RATES_KEY = "polyglot-offline-rates";
const PHRASES_KEY = "polyglot-offline-phrases";

// ─── Currency rates ─────────────────────────────────────────────────────────

export interface CachedRates {
  base: string;
  rates: Record<string, number>;
  date: string;
  cachedAt: string; // ISO timestamp
}

export function saveCurrencyRates(base: string, rates: Record<string, number>, date: string) {
  const data: CachedRates = {
    base,
    rates,
    date,
    cachedAt: new Date().toISOString(),
  };
  try {
    const existing = loadAllCachedRates();
    existing[base] = data;
    localStorage.setItem(RATES_KEY, JSON.stringify(existing));
  } catch {}
}

export function loadCachedRates(base: string): CachedRates | null {
  try {
    const all = loadAllCachedRates();
    return all[base] || null;
  } catch {
    return null;
  }
}

export function loadAllCachedRates(): Record<string, CachedRates> {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getLastRateDate(): string | null {
  try {
    const all = loadAllCachedRates();
    const dates = Object.values(all).map((r) => r.cachedAt);
    if (dates.length === 0) return null;
    return dates.sort().reverse()[0];
  } catch {
    return null;
  }
}

// ─── Phrases ────────────────────────────────────────────────────────────────

// Key: "phraseText__langCode" → translation
export function savePhraseTranslations(translations: Record<string, string>) {
  try {
    const existing = loadAllPhraseTranslations();
    Object.assign(existing, translations);
    localStorage.setItem(PHRASES_KEY, JSON.stringify(existing));
  } catch {}
}

export function loadAllPhraseTranslations(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PHRASES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getPhraseTranslation(phrase: string, langCode: string): string | null {
  const all = loadAllPhraseTranslations();
  return all[`${phrase}__${langCode}`] || null;
}

export function getCachedPhraseLangs(): string[] {
  const all = loadAllPhraseTranslations();
  const langs = new Set<string>();
  Object.keys(all).forEach((key) => {
    const parts = key.split("__");
    if (parts.length === 2) langs.add(parts[1]);
  });
  return [...langs];
}

export function getPhraseCountForLang(langCode: string): number {
  const all = loadAllPhraseTranslations();
  return Object.keys(all).filter((k) => k.endsWith(`__${langCode}`)).length;
}

// ─── i18n cached languages ──────────────────────────────────────────────────

export function getCachedUILanguages(): string[] {
  const langs: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("polyglot-ui-")) {
        langs.push(key.replace("polyglot-ui-", ""));
      }
    }
  } catch {}
  return langs;
}

// ─── Offline status ─────────────────────────────────────────────────────────

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

// ─── Connection quality monitor ─────────────────────────────────────────────

let lastResponseTime = 0;
let slowCount = 0;
const SLOW_THRESHOLD_MS = 3000;
const SLOW_COUNT_TRIGGER = 2;

export function reportResponseTime(ms: number) {
  lastResponseTime = ms;
  if (ms > SLOW_THRESHOLD_MS) {
    slowCount++;
  } else {
    slowCount = Math.max(0, slowCount - 1);
  }
}

export function isConnectionSlow(): boolean {
  return slowCount >= SLOW_COUNT_TRIGGER || !isOnline();
}

export function getLastResponseTime(): number {
  return lastResponseTime;
}

export function resetConnectionMonitor() {
  lastResponseTime = 0;
  slowCount = 0;
}

// ─── Local TTS fallback (Web Speech API) ────────────────────────────────────

// Language code → BCP 47 locale mapping for speech synthesis
const TTS_LOCALE_MAP: Record<string, string> = {
  en: "en-US", it: "it-IT", es: "es-ES", fr: "fr-FR", de: "de-DE",
  pt: "pt-BR", ru: "ru-RU", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR",
  ar: "ar-SA", hi: "hi-IN", tr: "tr-TR", pl: "pl-PL", nl: "nl-NL",
  sv: "sv-SE", da: "da-DK", no: "nb-NO", fi: "fi-FI", el: "el-GR",
  cs: "cs-CZ", hu: "hu-HU", ro: "ro-RO", bg: "bg-BG", th: "th-TH",
  vi: "vi-VN", id: "id-ID", ms: "ms-MY", tl: "fil-PH",
};

export function canUseLocalTTS(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function playLocalTTS(text: string, langCode?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!canUseLocalTTS()) {
      reject(new Error("Speech synthesis not available"));
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const locale = langCode ? (TTS_LOCALE_MAP[langCode] || langCode) : undefined;
    if (locale) utterance.lang = locale;
    // Use stored speed preference if available
    try {
      const stored = localStorage.getItem("polyglot-user-storage");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.state?.ttsSpeed) utterance.rate = parsed.state.ttsSpeed;
        else utterance.rate = 1.0;
      } else {
        utterance.rate = 1.0;
      }
    } catch {
      utterance.rate = 1.0;
    }
    utterance.pitch = 1.0;

    // Try to find a voice for the language
    const voices = window.speechSynthesis.getVoices();
    if (locale && voices.length > 0) {
      const match = voices.find((v) => v.lang.startsWith(locale.split("-")[0]));
      if (match) utterance.voice = match;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);
    window.speechSynthesis.speak(utterance);
  });
}
