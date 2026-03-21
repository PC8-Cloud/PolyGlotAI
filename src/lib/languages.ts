export interface Language {
  code: string;
  label: string;
  flag: string;
  locale: string; // BCP-47 for SpeechRecognition
}

export const LANGUAGES: Language[] = [
  // --- Top Global Languages ---
  { code: "en", label: "English", flag: "🇬🇧", locale: "en-US" },
  { code: "zh", label: "中文", flag: "🇨🇳", locale: "zh-CN" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳", locale: "hi-IN" },
  { code: "es", label: "Español", flag: "🇪🇸", locale: "es-ES" },
  { code: "ar", label: "العربية", flag: "🇸🇦", locale: "ar-SA" },
  { code: "fr", label: "Français", flag: "🇫🇷", locale: "fr-FR" },
  { code: "pt", label: "Português", flag: "🇧🇷", locale: "pt-BR" },
  { code: "ru", label: "Русский", flag: "🇷🇺", locale: "ru-RU" },
  { code: "ja", label: "日本語", flag: "🇯🇵", locale: "ja-JP" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", locale: "de-DE" },
  { code: "it", label: "Italiano", flag: "🇮🇹", locale: "it-IT" },
  { code: "ko", label: "한국어", flag: "🇰🇷", locale: "ko-KR" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷", locale: "tr-TR" },
  { code: "pl", label: "Polski", flag: "🇵🇱", locale: "pl-PL" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱", locale: "nl-NL" },
  { code: "sv", label: "Svenska", flag: "🇸🇪", locale: "sv-SE" },
  { code: "da", label: "Dansk", flag: "🇩🇰", locale: "da-DK" },
  { code: "no", label: "Norsk", flag: "🇳🇴", locale: "nb-NO" },
  { code: "fi", label: "Suomi", flag: "🇫🇮", locale: "fi-FI" },
  { code: "el", label: "Ελληνικά", flag: "🇬🇷", locale: "el-GR" },

  // --- Asia & Southeast Asia ---
  { code: "th", label: "ไทย", flag: "🇹🇭", locale: "th-TH" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳", locale: "vi-VN" },
  { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩", locale: "id-ID" },
  { code: "ms", label: "Bahasa Melayu", flag: "🇲🇾", locale: "ms-MY" },
  { code: "tl", label: "Tagalog", flag: "🇵🇭", locale: "fil-PH" },
  { code: "bn", label: "বাংলা", flag: "🇧🇩", locale: "bn-BD" },
  { code: "ta", label: "தமிழ்", flag: "🇮🇳", locale: "ta-IN" },
  { code: "te", label: "తెలుగు", flag: "🇮🇳", locale: "te-IN" },
  { code: "ml", label: "മലയാളം", flag: "🇮🇳", locale: "ml-IN" },
  { code: "kn", label: "ಕನ್ನಡ", flag: "🇮🇳", locale: "kn-IN" },
  { code: "mr", label: "मराठी", flag: "🇮🇳", locale: "mr-IN" },
  { code: "gu", label: "ગુજરાતી", flag: "🇮🇳", locale: "gu-IN" },
  { code: "pa", label: "ਪੰਜਾਬੀ", flag: "🇮🇳", locale: "pa-IN" },
  { code: "ur", label: "اردو", flag: "🇵🇰", locale: "ur-PK" },
  { code: "ne", label: "नेपाली", flag: "🇳🇵", locale: "ne-NP" },
  { code: "si", label: "සිංහල", flag: "🇱🇰", locale: "si-LK" },
  { code: "km", label: "ខ្មែរ", flag: "🇰🇭", locale: "km-KH" },
  { code: "lo", label: "ລາວ", flag: "🇱🇦", locale: "lo-LA" },
  { code: "my", label: "မြန်မာ", flag: "🇲🇲", locale: "my-MM" },
  { code: "zh-TW", label: "中文 (繁體)", flag: "🇹🇼", locale: "zh-TW" },
  { code: "mn", label: "Монгол", flag: "🇲🇳", locale: "mn-MN" },

  // --- Eastern Europe & Central Asia ---
  { code: "uk", label: "Українська", flag: "🇺🇦", locale: "uk-UA" },
  { code: "cs", label: "Čeština", flag: "🇨🇿", locale: "cs-CZ" },
  { code: "ro", label: "Română", flag: "🇷🇴", locale: "ro-RO" },
  { code: "hu", label: "Magyar", flag: "🇭🇺", locale: "hu-HU" },
  { code: "bg", label: "Български", flag: "🇧🇬", locale: "bg-BG" },
  { code: "hr", label: "Hrvatski", flag: "🇭🇷", locale: "hr-HR" },
  { code: "sk", label: "Slovenčina", flag: "🇸🇰", locale: "sk-SK" },
  { code: "sl", label: "Slovenščina", flag: "🇸🇮", locale: "sl-SI" },
  { code: "sr", label: "Српски", flag: "🇷🇸", locale: "sr-RS" },
  { code: "bs", label: "Bosanski", flag: "🇧🇦", locale: "bs-BA" },
  { code: "mk", label: "Македонски", flag: "🇲🇰", locale: "mk-MK" },
  { code: "sq", label: "Shqip", flag: "🇦🇱", locale: "sq-AL" },
  { code: "lt", label: "Lietuvių", flag: "🇱🇹", locale: "lt-LT" },
  { code: "lv", label: "Latviešu", flag: "🇱🇻", locale: "lv-LV" },
  { code: "et", label: "Eesti", flag: "🇪🇪", locale: "et-EE" },
  { code: "ka", label: "ქართული", flag: "🇬🇪", locale: "ka-GE" },
  { code: "hy", label: "Հայերեն", flag: "🇦🇲", locale: "hy-AM" },
  { code: "az", label: "Azərbaycan", flag: "🇦🇿", locale: "az-AZ" },
  { code: "kk", label: "Қазақ", flag: "🇰🇿", locale: "kk-KZ" },
  { code: "uz", label: "Oʻzbek", flag: "🇺🇿", locale: "uz-UZ" },
  { code: "be", label: "Беларуская", flag: "🇧🇾", locale: "be-BY" },

  // --- Middle East ---
  { code: "he", label: "עברית", flag: "🇮🇱", locale: "he-IL" },
  { code: "fa", label: "فارسی", flag: "🇮🇷", locale: "fa-IR" },
  { code: "ku", label: "Kurdî", flag: "🇮🇶", locale: "ku" },
  { code: "ps", label: "پښتو", flag: "🇦🇫", locale: "ps-AF" },

  // --- Africa ---
  { code: "sw", label: "Kiswahili", flag: "🇰🇪", locale: "sw-KE" },
  { code: "am", label: "አማርኛ", flag: "🇪🇹", locale: "am-ET" },
  { code: "ha", label: "Hausa", flag: "🇳🇬", locale: "ha-NG" },
  { code: "yo", label: "Yorùbá", flag: "🇳🇬", locale: "yo-NG" },
  { code: "ig", label: "Igbo", flag: "🇳🇬", locale: "ig-NG" },
  { code: "zu", label: "isiZulu", flag: "🇿🇦", locale: "zu-ZA" },
  { code: "xh", label: "isiXhosa", flag: "🇿🇦", locale: "xh-ZA" },
  { code: "af", label: "Afrikaans", flag: "🇿🇦", locale: "af-ZA" },
  { code: "so", label: "Soomaali", flag: "🇸🇴", locale: "so-SO" },
  { code: "mg", label: "Malagasy", flag: "🇲🇬", locale: "mg-MG" },
  { code: "rw", label: "Kinyarwanda", flag: "🇷🇼", locale: "rw-RW" },
  { code: "sn", label: "Shona", flag: "🇿🇼", locale: "sn-ZW" },

  // --- Europe (remaining) ---
  { code: "ca", label: "Català", flag: "🇪🇸", locale: "ca-ES" },
  { code: "gl", label: "Galego", flag: "🇪🇸", locale: "gl-ES" },
  { code: "eu", label: "Euskara", flag: "🇪🇸", locale: "eu-ES" },
  { code: "is", label: "Íslenska", flag: "🇮🇸", locale: "is-IS" },
  { code: "ga", label: "Gaeilge", flag: "🇮🇪", locale: "ga-IE" },
  { code: "cy", label: "Cymraeg", flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", locale: "cy-GB" },
  { code: "mt", label: "Malti", flag: "🇲🇹", locale: "mt-MT" },
  { code: "lb", label: "Lëtzebuergesch", flag: "🇱🇺", locale: "lb-LU" },

  // --- Americas ---
  { code: "ht", label: "Kreyòl Ayisyen", flag: "🇭🇹", locale: "ht-HT" },
  { code: "qu", label: "Quechua", flag: "🇵🇪", locale: "qu-PE" },
  { code: "gn", label: "Guaraní", flag: "🇵🇾", locale: "gn-PY" },

  // --- Pacific ---
  { code: "mi", label: "Te Reo Māori", flag: "🇳🇿", locale: "mi-NZ" },
  { code: "sm", label: "Gagana Samoa", flag: "🇼🇸", locale: "sm-WS" },
  { code: "haw", label: "ʻŌlelo Hawaiʻi", flag: "🇺🇸", locale: "haw-US" },

  // --- Other widely spoken ---
  { code: "jv", label: "Basa Jawa", flag: "🇮🇩", locale: "jv-ID" },
  { code: "su", label: "Basa Sunda", flag: "🇮🇩", locale: "su-ID" },
  { code: "ceb", label: "Cebuano", flag: "🇵🇭", locale: "ceb-PH" },
  { code: "ny", label: "Chichewa", flag: "🇲🇼", locale: "ny-MW" },
  { code: "co", label: "Corsu", flag: "🇫🇷", locale: "co-FR" },
  { code: "fy", label: "Frysk", flag: "🇳🇱", locale: "fy-NL" },
  { code: "sd", label: "سنڌي", flag: "🇵🇰", locale: "sd-PK" },
  { code: "tt", label: "Татар", flag: "🇷🇺", locale: "tt-RU" },
  { code: "ug", label: "ئۇيغۇرچە", flag: "🇨🇳", locale: "ug-CN" },
  { code: "tk", label: "Türkmen", flag: "🇹🇲", locale: "tk-TM" },
  { code: "tg", label: "Тоҷикӣ", flag: "🇹🇯", locale: "tg-TJ" },
  { code: "ky", label: "Кыргызча", flag: "🇰🇬", locale: "ky-KG" },
  { code: "la", label: "Latina", flag: "🇻🇦", locale: "la" },
  { code: "eo", label: "Esperanto", flag: "🌍", locale: "eo" },
];

export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function getLocaleForCode(code: string): string {
  return getLanguageByCode(code)?.locale || code;
}

export function getLabelForCode(code: string): string {
  return getLanguageByCode(code)?.label || code.toUpperCase();
}

/** Returns languages split into favorites and rest */
export function getSortedLanguages(favoriteCodes: string[]): { favorites: Language[]; rest: Language[] } {
  const favSet = new Set(favoriteCodes);
  const favorites = favoriteCodes
    .map((code) => LANGUAGES.find((l) => l.code === code))
    .filter((l): l is Language => !!l);
  const rest = LANGUAGES.filter((l) => !favSet.has(l.code));
  return { favorites, rest };
}
