import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../lib/firebase-helpers";
import { Settings, Camera, MessagesSquare, Coins, MessageSquarePlus, Users, Globe, ChevronLeft, WifiOff, Download, Check, Loader2, Volume2 } from "lucide-react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "../firebase";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { translateText } from "../lib/openai";
import {
  getCachedUILanguages,
  getLastRateDate,
  getCachedPhraseLangs,
  getPhraseCountForLang,
  savePhraseTranslations,
  isOnline,
} from "../lib/offline";
import { ALL_PHRASE_TEXTS } from "../lib/phrases-data";
import { playTTS } from "../lib/openai";

export default function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOffline, setShowOffline] = useState(false);

  const {
    uiLanguage,
    setUiLanguage,
    defaultSourceLanguage,
    defaultTargetLanguages,
    setDefaultSourceLanguage,
    setDefaultTargetLanguages,
    ttsVoice,
    setTtsVoice,
    ttsSpeed,
    setTtsSpeed,
  } = useUserStore();

  const t = useTranslation(uiLanguage);

  // Local state for settings modal
  const [tempSource, setTempSource] = useState(defaultSourceLanguage);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  const TTS_VOICES = [
    { id: "alloy", label: "Alloy", desc: "Neutra" },
    { id: "ash", label: "Ash", desc: "Maschile, calda" },
    { id: "ballad", label: "Ballad", desc: "Maschile, morbida" },
    { id: "coral", label: "Coral", desc: "Femminile, calda" },
    { id: "echo", label: "Echo", desc: "Maschile, profonda" },
    { id: "fable", label: "Fable", desc: "Maschile, narrativa" },
    { id: "nova", label: "Nova", desc: "Femminile, vivace" },
    { id: "onyx", label: "Onyx", desc: "Maschile, autorevole" },
    { id: "sage", label: "Sage", desc: "Femminile, calma" },
    { id: "shimmer", label: "Shimmer", desc: "Femminile, luminosa" },
  ];

  const handlePreviewVoice = async (voiceId: string) => {
    if (previewingVoice) return;
    setPreviewingVoice(voiceId);
    try {
      await playTTS("Hello! This is how I sound.", voiceId as any, 1.0, "en");
    } catch (e) {
      console.error("Voice preview failed:", e);
    } finally {
      setPreviewingVoice(null);
    }
  };
  const [tempTargets, setTempTargets] = useState<string[]>(defaultTargetLanguages);

  const handleStartSession = async () => {
    if (!auth.currentUser) {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } catch (e) {
        console.error("Login failed", e);
        return;
      }
    }

    setLoading(true);
    try {
      const sessionId = await createSession(
        "Live Translation",
        defaultSourceLanguage,
        defaultTargetLanguages
      );
      if (sessionId) {
        navigate(`/session/${sessionId}/host`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = () => {
    setDefaultSourceLanguage(tempSource);
    setDefaultTargetLanguages(tempTargets);
    setShowSettings(false);
  };

  const toggleTargetLanguage = (code: string) => {
    if (tempTargets.includes(code)) {
      setTempTargets(tempTargets.filter(l => l !== code));
    } else {
      setTempTargets([...tempTargets, code]);
    }
  };

  // Offline status state
  const [cachedUILangs, setCachedUILangs] = useState<string[]>([]);
  const [cachedPhraseLangs, setCachedPhraseLangs] = useState<string[]>([]);
  const [lastRateDate, setLastRateDate] = useState<string | null>(null);
  const [downloadingPhrases, setDownloadingPhrases] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");

  // Refresh offline status when modal opens
  useEffect(() => {
    if (showOffline) {
      setCachedUILangs(getCachedUILanguages());
      setCachedPhraseLangs(getCachedPhraseLangs());
      setLastRateDate(getLastRateDate());
    }
  }, [showOffline]);

  // Download all phrases for a language
  const handleDownloadPhrases = async (langCode: string) => {
    if (downloadingPhrases) return;
    setDownloadingPhrases(true);
    setDownloadProgress(`0/${ALL_PHRASE_TEXTS.length}`);

    try {
      const BATCH_SIZE = 5;
      for (let i = 0; i < ALL_PHRASE_TEXTS.length; i += BATCH_SIZE) {
        const batch = ALL_PHRASE_TEXTS.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((phrase) => translateText(phrase, "en", [langCode])),
        );
        const toSave: Record<string, string> = {};
        batch.forEach((phrase, idx) => {
          const key = `${phrase}__${langCode}`;
          toSave[key] = results[idx][langCode] || "";
        });
        savePhraseTranslations(toSave);
        setDownloadProgress(`${Math.min(i + BATCH_SIZE, ALL_PHRASE_TEXTS.length)}/${ALL_PHRASE_TEXTS.length}`);
      }
      setCachedPhraseLangs(getCachedPhraseLangs());
    } catch (e: any) {
      console.error("Phrase download failed:", e);
    } finally {
      setDownloadingPhrases(false);
      setDownloadProgress("");
    }
  };

  const handleDownloadAllPhrases = async () => {
    const targetLangs = LANGUAGES.map((l) => l.code);
    for (const lang of targetLangs) {
      await handleDownloadPhrases(lang);
    }
  };

  const btnClass = "flex flex-col items-center justify-center bg-[#123182] hover:bg-[#295BDB] active:bg-[#0E2666] rounded-2xl p-6 transition-all aspect-square shadow-lg hover:scale-[1.03] border border-[#FFFFFF14]";

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col items-center justify-center p-6 font-sans relative">
      {/* Settings gear icon — top right */}
      <button
        onClick={() => {
          setTempSource(defaultSourceLanguage);
          setTempTargets(defaultTargetLanguages);
          setShowSettings(true);
        }}
        className="absolute top-5 right-5 p-2.5 rounded-full bg-[#123182] border border-[#FFFFFF14] text-[#F4F4F4] hover:bg-[#295BDB] transition-colors"
      >
        <Settings className="w-5 h-5" />
      </button>

      <div className="w-full max-w-md">
        <div className="grid grid-cols-2 gap-5">
          <button onClick={() => navigate("/camera")} className={btnClass}>
            <Camera className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("camera")}</span>
          </button>

          <button onClick={() => navigate("/conversation")} className={btnClass}>
            <MessagesSquare className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("conversation")}</span>
          </button>

          <button onClick={() => navigate("/converter")} className={btnClass}>
            <Coins className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("convertUnits")}</span>
          </button>

          <button onClick={() => navigate("/phrases")} className={btnClass}>
            <MessageSquarePlus className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("usefulPhrases")}</span>
          </button>

          <button onClick={() => setShowOffline(true)} className={btnClass}>
            <WifiOff className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("offlineFunctions")}</span>
          </button>

          <button
            onClick={() => navigate("/group")}
            className={btnClass}
          >
            <Users className="w-12 h-12 mb-3" />
            <span className="text-sm font-medium text-center leading-tight">{t("groupTranslation")}</span>
          </button>
        </div>
      </div>

      {/* Offline Functions Modal */}
      {showOffline && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0E2666] rounded-3xl max-w-md w-full flex flex-col relative border border-[#FFFFFF14] max-h-[90vh]">
            <div className="flex items-center gap-3 p-6 pb-4 border-b border-[#FFFFFF14] shrink-0">
              <button onClick={() => setShowOffline(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h2 className="text-2xl font-bold">{t("offlineFunctions")}</h2>
            </div>

            <div className="overflow-y-auto p-6 pt-4 space-y-3">
              {/* Offline Phrases */}
              <div className="bg-[#02114A] border border-[#FFFFFF14] rounded-2xl p-4">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">💬</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#F4F4F4]">{t("offlinePhrases")}</p>
                    <p className="text-xs text-[#F4F4F4]/40 mt-0.5">
                      {cachedPhraseLangs.length > 0
                        ? `${cachedPhraseLangs.length} ${t("languagesAvailable")}`
                        : t("downloadPhrases")}
                    </p>
                  </div>
                  {downloadingPhrases ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Loader2 className="w-4 h-4 text-[#295BDB] animate-spin" />
                      <span className="text-xs text-[#295BDB]">{downloadProgress}</span>
                    </div>
                  ) : cachedPhraseLangs.length > 0 ? (
                    <Check className="w-5 h-5 text-green-400 shrink-0" />
                  ) : null}
                </div>

                {/* Per-language download buttons */}
                <div className="mt-3 pl-10 space-y-2">
                  {cachedPhraseLangs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {cachedPhraseLangs.map((code) => {
                        const lang = LANGUAGES.find((l) => l.code === code);
                        const count = getPhraseCountForLang(code);
                        return (
                          <span key={code} className="bg-[#123182] px-2 py-0.5 rounded-full text-xs text-[#F4F4F4]/60">
                            {lang?.flag} {count} {t("phrasesAvailable")}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGES.map((lang) => {
                      const hasCache = cachedPhraseLangs.includes(lang.code);
                      return (
                        <button
                          key={lang.code}
                          onClick={() => handleDownloadPhrases(lang.code)}
                          disabled={downloadingPhrases}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border disabled:opacity-40 ${
                            hasCache
                              ? "bg-green-500/10 border-green-500/30 text-green-400"
                              : "bg-[#123182] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#295BDB] hover:text-[#295BDB]"
                          }`}
                        >
                          {hasCache ? <Check className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                          {lang.flag} {lang.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Offline Conversions */}
              <div className="bg-[#02114A] border border-[#FFFFFF14] rounded-2xl p-4">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">🔄</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#F4F4F4]">{t("offlineConversions")}</p>
                    <p className="text-xs text-green-400 mt-0.5">{t("worksOffline")}</p>
                  </div>
                  <Check className="w-5 h-5 text-green-400 shrink-0" />
                </div>
              </div>


            </div>

            <button
              onClick={() => setShowOffline(false)}
              className="mt-6 w-full bg-[#123182] hover:bg-[#295BDB] text-[#F4F4F4] font-medium py-3 rounded-xl transition-colors"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0E2666] p-6 rounded-3xl max-w-md w-full flex flex-col relative border border-[#FFFFFF14] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => setShowSettings(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h2 className="text-2xl font-bold">{t("settings")}</h2>
            </div>

            <div className="space-y-6">
              {/* System Language */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-[#F4F4F4]/50" />
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("systemLanguage")}</label>
                </div>
                <p className="text-xs text-[#F4F4F4]/40 mb-3">{t("systemLanguageDesc")}</p>
                <select
                  value={uiLanguage}
                  onChange={(e) => setUiLanguage(e.target.value)}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.flag} {lang.label}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-[#FFFFFF14]" />

              {/* Source Language */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">{t("sourceLanguage")}</label>
                <select
                  value={tempSource}
                  onChange={(e) => setTempSource(e.target.value)}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.flag} {lang.label}</option>
                  ))}
                </select>
              </div>

              {/* Target Languages */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">{t("targetLanguages")}</label>
                <p className="text-xs text-[#F4F4F4]/40 mb-3">{t("selectLanguages")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.filter(l => l.code !== tempSource).map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => toggleTargetLanguage(lang.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                        tempTargets.includes(lang.code)
                          ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                          : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                      }`}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#FFFFFF14]" />

              {/* TTS Voice */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 className="w-4 h-4 text-[#F4F4F4]/50" />
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("voice")}</label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TTS_VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setTtsVoice(v.id);
                        handlePreviewVoice(v.id);
                      }}
                      disabled={previewingVoice !== null}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border disabled:opacity-60 ${
                        ttsVoice === v.id
                          ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                          : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="block">{v.label}</span>
                        <span className="block text-[10px] opacity-60">{v.desc}</span>
                      </div>
                      {previewingVoice === v.id && (
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Speed */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("voiceSpeed")}</label>
                  <span className="text-sm font-mono text-[#295BDB]">{ttsSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.1"
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#295BDB]"
                />
                <div className="flex justify-between text-[10px] text-[#F4F4F4]/30 mt-1">
                  <span>{t("slow")}</span>
                  <span>{t("normal")}</span>
                  <span>{t("fast")}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-[#123182] hover:bg-[#0E2666] text-[#F4F4F4] font-medium py-3 rounded-xl transition-colors"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={saveSettings}
                  className="flex-1 bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-medium py-3 rounded-xl transition-colors"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
