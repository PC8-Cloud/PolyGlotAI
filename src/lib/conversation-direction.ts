// Direction detection for the two-way Conversation translator.
//
// Given a transcript and the two configured languages ("you" = the local user,
// "them" = the other party), decide which side spoke. This must NOT assume the
// conversation strictly alternates: the same person often speaks twice in a row
// (repeats, corrections, follow-ups). The old heuristic flipped the side on
// every ambiguous turn, so a second Italian sentence was mis-routed to the
// English side and left untranslated.
//
// Priority of signals, strongest first:
//   1. Non-Latin script — decisive and cheap (Japanese, Cyrillic, Arabic, ...).
//   2. Latin-script text scoring — stopwords + orthographic (accents) cues.
//   3. Ambiguous — keep the previous side instead of blindly alternating.

export type Side = "you" | "them";

// Common function words per language. Kept deliberately short but discriminative.
const LANGUAGE_HINTS: Record<string, string[]> = {
  // Note: "a" is intentionally excluded — it is also a very common Italian
  // preposition and caused Italian speech to be scored as English.
  en: ["the", "an", "and", "is", "are", "do", "does", "did", "have", "has", "you", "we", "they", "can", "what", "where", "why", "how", "of", "hello", "thanks", "thank"],
  it: ["il", "lo", "la", "gli", "le", "un", "una", "e", "sei", "sono", "hai", "avete", "come", "dove", "perche", "che", "non", "di", "per", "con", "ho", "ciao", "grazie", "bene", "va"],
  es: ["el", "la", "los", "las", "un", "una", "y", "es", "eres", "tienes", "como", "donde", "por", "que", "no", "de", "hola", "gracias", "muy", "bien"],
  fr: ["le", "la", "les", "un", "une", "et", "est", "suis", "etes", "avez", "comme", "ou", "pourquoi", "que", "je", "vous", "bonjour", "merci", "pas", "de"],
  de: ["der", "die", "das", "ein", "eine", "und", "ist", "sind", "hast", "haben", "wie", "wo", "warum", "ich", "nicht", "danke", "hallo", "mit", "auch"],
  pt: ["o", "a", "os", "as", "um", "uma", "e", "que", "nao", "de", "para", "com", "como", "onde", "obrigado", "ola", "bem", "voce", "sim"],
};

// Characteristic letters/marks that strongly suggest a Latin-script language.
// English gets a small negative-space advantage by having essentially none.
const ORTHOGRAPHIC_HINTS: Record<string, RegExp> = {
  it: /[àèéìòù]/i,
  es: /[ñáíóúü¿¡]/i,
  fr: /[çàâéèêëîïôûùœ]/i,
  de: /[äöüß]/i,
  pt: /[ãõâêôáéíóúàç]/i,
};

// Base language -> Unicode script. Used for decisive non-Latin detection.
const LANG_SCRIPT: Record<string, string> = {
  ja: "kana", // hiragana/katakana (may also contain Han)
  ko: "hangul",
   zh: "han",
  ru: "cyrillic",
  uk: "cyrillic",
  bg: "cyrillic",
  sr: "cyrillic",
  ar: "arabic",
  fa: "arabic",
  ur: "arabic",
  he: "hebrew",
  el: "greek",
  th: "thai",
  hi: "devanagari",
};

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  han: /\p{Script=Han}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  hebrew: /\p{Script=Hebrew}/u,
  greek: /\p{Script=Greek}/u,
  thai: /\p{Script=Thai}/u,
  devanagari: /\p{Script=Devanagari}/u,
};

function baseCode(langCode: string): string {
  return String(langCode || "").toLowerCase().split("-")[0];
}

export function languageScoreFromText(text: string, langCode: string): number {
  const base = baseCode(langCode);
  const hints = LANGUAGE_HINTS[base];
  // Strip accents before matching so "perché"/"è" match the (accent-free)
  // hint lists. The accent itself is still rewarded via ORTHOGRAPHIC_HINTS,
  // which runs on the raw text below.
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  let score = 0;
  if (hints && words.length > 0) {
    for (const word of words) {
      if (hints.includes(word)) score += 1;
    }
  }

  // Orthographic bonus: accented letters / digraphs characteristic of the
  // language. Bounded to 1 so it nudges ties without overriding real word hits.
  const ortho = ORTHOGRAPHIC_HINTS[base];
  if (ortho && ortho.test(text)) score += 1;

  return score;
}

// Decide the side from Unicode script alone. Returns null when the transcript's
// script doesn't uniquely match exactly one of the two configured languages
// (e.g. both are Latin, or neither uses the detected script).
function sideFromScript(text: string, yourLang: string, theirLang: string): Side | null {
  const yourScript = LANG_SCRIPT[baseCode(yourLang)];
  const theirScript = LANG_SCRIPT[baseCode(theirLang)];
  if (!yourScript && !theirScript) return null;

  const hasYour = yourScript ? SCRIPT_PATTERNS[yourScript]?.test(text) : false;
  const hasTheir = theirScript ? SCRIPT_PATTERNS[theirScript]?.test(text) : false;

  if (hasYour && !hasTheir) return "you";
  if (hasTheir && !hasYour) return "them";
  return null;
}

export function chooseSideByText(params: {
  transcript: string;
  yourLang: string;
  theirLang: string;
  lastSide: Side | null;
}): Side {
  const { transcript, yourLang, theirLang, lastSide } = params;

  // 1. Non-Latin script is decisive.
  const scriptSide = sideFromScript(transcript, yourLang, theirLang);
  if (scriptSide) return scriptSide;

  // 2. Text scoring. Any positive difference decides — we do not require a
  //    margin, because requiring one is what pushed most turns into the
  //    (previously alternating) tie-breaker.
  const yourScore = languageScoreFromText(transcript, yourLang);
  const theirScore = languageScoreFromText(transcript, theirLang);
  if (yourScore > theirScore) return "you";
  if (theirScore > yourScore) return "them";

  // 3. Genuinely ambiguous (numbers, a bare name, an unknown language): keep
  //    the current side. This assumes the same speaker continues rather than
  //    that speakers strictly alternate — the latter caused the reported bug.
  return lastSide ?? "you";
}
