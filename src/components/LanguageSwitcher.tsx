import React from "react";
import { useUserStore } from "../lib/store";
import { Globe } from "lucide-react";

const languages = [
  { code: "en", label: "EN" },
  { code: "it", label: "IT" },
  { code: "es", label: "ES" },
  { code: "fr", label: "FR" },
  { code: "de", label: "DE" },
];

export function LanguageSwitcher() {
  const { uiLanguage, setUiLanguage } = useUserStore();

  return (
    <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1.5 rounded-full border border-slate-800">
      <Globe className="w-4 h-4 text-slate-400" />
      <div className="flex gap-1">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => setUiLanguage(lang.code)}
            className={`text-xs font-medium px-2 py-1 rounded-md transition-colors ${
              uiLanguage === lang.code
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
