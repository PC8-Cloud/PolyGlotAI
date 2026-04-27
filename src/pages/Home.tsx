import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../lib/firebase-helpers";
import { Settings, Camera, MessagesSquare, Coins, MessageSquarePlus, Users, Globe, ChevronLeft, WifiOff, Download, Check, Loader2, GraduationCap, Plus, X, Search, User, Pencil, Lock } from "lucide-react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "../firebase";
import { useTranslation } from "../lib/i18n";
import { useUserStore, useNetworkStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
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
import { getTrialStatus, getTrialRemainingDaily } from "../lib/trial";
import { hasFeature } from "../lib/subscription";
import VoiceCloneSetup from "../components/VoiceCloneSetup";

export default function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [langSearch, setLangSearch] = useState("");
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempGender, setTempGender] = useState<"male" | "female" | "">("");
  const [tempLang, setTempLang] = useState("");
  const [tempSpeed, setTempSpeed] = useState(1.0);
  const [settingsLang, setSettingsLang] = useState("");
  const [settingsSpeed, setSettingsSpeed] = useState(1.0);
  const [settingsTranslationPerformance, setSettingsTranslationPerformance] = useState<"auto" | "fast" | "balanced">("auto");

  const {
    uiLanguage,
    plan,
    setUiLanguage,
    ttsSpeed,
    setTtsSpeed,
    favoriteLanguages,
    setFavoriteLanguages,
    userName,
    setUserName,
    userGender,
    setUserGender,
    translationPerformance,
    setTranslationPerformance,
  } = useUserStore();

  const t = useTranslation(uiLanguage);
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");
  const trial = getTrialStatus();
  const showTrialDetails = plan === "free" && trial.isActive;
  const canUseVoiceClone = hasFeature("voiceClone");
  const trialConversationMin = Math.floor(getTrialRemainingDaily("conversation_ms") / 60000);
  const trialMegaphoneMin = Math.floor(getTrialRemainingDaily("megaphone_ms") / 60000);
  const trialCameraScans = getTrialRemainingDaily("camera_scans");
  const trialTextRequests = getTrialRemainingDaily("text_translate_requests");

  const translationModeLabel =
    uiLanguage === "it"
      ? { title: "Modalita traduzione live", desc: "Auto adatta velocita e qualita in base a rete e carico.", auto: "Auto", fast: "Rapida", balanced: "Bilanciata" }
      : { title: "Live Translation Mode", desc: "Auto balances speed and quality based on network and load.", auto: "Auto", fast: "Fast", balanced: "Balanced" };

  const openSettings = () => {
    setSettingsLang(uiLanguage);
    setSettingsSpeed(ttsSpeed);
    setSettingsTranslationPerformance(translationPerformance);
    setShowSettings(true);
  };

  const handleSaveSettings = () => {
    setUiLanguage(settingsLang);
    setTtsSpeed(settingsSpeed);
    setTranslationPerformance(settingsTranslationPerformance);
    setShowSettings(false);
  };
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
        uiLanguage,
        favoriteLanguages
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
          batch.map((phrase) => translateText(phrase, "en", [langCode], {
            mode: "phrases",
          })),
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

  const { isOffline } = useNetworkStore();

  const btnClass = "flex flex-col items-center justify-center bg-[#123182] hover:bg-[#295BDB] active:bg-[#0E2666] rounded-2xl p-4 transition-all aspect-square shadow-lg hover:scale-[1.03] border border-[#FFFFFF14]";
  const btnDisabled = "flex flex-col items-center justify-center bg-[#123182]/40 rounded-2xl p-4 aspect-square shadow-lg border border-[#FFFFFF14] opacity-40 relative";

  // Features that work offline: phrases (cached), converter (local), offline panel, settings
  const OFFLINE_ROUTES = new Set(["/phrases", "/converter"]);

  const FeatureButton = ({ route, icon: Icon, label, onClick, detail }: { route?: string; icon: any; label: string; onClick?: () => void; detail?: string }) => {
    const needsInternet = route && !OFFLINE_ROUTES.has(route);
    const disabled = isOffline && needsInternet;

    const ariaLabel = [label, detail && !disabled ? detail : null, disabled ? t("offlineUnavailable") : null]
      .filter(Boolean)
      .join(", ");

    return (
      <button
        onClick={() => {
          if (disabled) return;
          if (onClick) onClick();
          else if (route) navigate(route);
        }}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        className={`${disabled ? btnDisabled : btnClass} relative`}
      >
        <Icon className="w-10 h-10 mb-2" aria-hidden="true" />
        <h2 className="text-sm font-medium text-center leading-tight">{label}</h2>
        {/* Fixed-height slot for detail badge — keeps all tiles uniform (FIX 6) */}
        <span className={`mt-2 text-[11px] leading-none rounded-full px-2 py-1 ${
          detail && !disabled
            ? "text-[#F4F4F4]/70 bg-[#02114A]/65 border border-[#FFFFFF14]"
            : "invisible"
        }`} aria-hidden="true">
          {detail || "\u00A0"}
        </span>
        {disabled && (
          <div className="absolute top-2 right-2" aria-hidden="true">
            <Lock className="w-3.5 h-3.5 text-[#F4F4F4]/60" />
          </div>
        )}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col items-center justify-center px-6 pb-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] font-sans relative">
      <h1 className="sr-only">PolyGlot AI</h1>

      {/* Offline mode banner */}
      {isOffline && (
        <div role="status" aria-live="polite" className="w-full max-w-md mb-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center gap-3">
          <WifiOff className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-400">{t("offlineMode")}</p>
            <p className="text-[11px] text-amber-400/60">{t("offlineModeDesc")}</p>
          </div>
        </div>
      )}

      <nav aria-label={t("a11yMainNav")} className="w-full max-w-md">
        <div className="grid grid-cols-2 gap-4">
          <FeatureButton
            route="/conversation"
            icon={MessagesSquare}
            label={t("conversation")}
            detail={showTrialDetails ? (isIt ? `${trialConversationMin} min` : `${trialConversationMin} min`) : undefined}
          />
          <FeatureButton route="/phrases" icon={MessageSquarePlus} label={t("usefulPhrases")} />
          <FeatureButton
            route="/learn"
            icon={GraduationCap}
            label={t("learn")}
            detail={showTrialDetails ? (isIt ? `${trialTextRequests} testi` : `${trialTextRequests} texts`) : undefined}
          />
          <FeatureButton
            route="/group"
            icon={Users}
            label={t("groupTranslation")}
            detail={showTrialDetails ? (isIt ? `${trialMegaphoneMin} min` : `${trialMegaphoneMin} min`) : undefined}
          />
          <FeatureButton
            route="/camera"
            icon={Camera}
            label={t("camera")}
            detail={showTrialDetails ? (isIt ? `${trialCameraScans} scan` : `${trialCameraScans} scans`) : undefined}
          />
          <FeatureButton route="/converter" icon={Coins} label={t("convertUnits")} />
          <FeatureButton icon={WifiOff} label={t("offlineFunctions")} onClick={() => setShowOffline(true)} />
          <FeatureButton icon={Settings} label={t("settings")} onClick={openSettings} />
        </div>
      </nav>

      {/* Offline Functions Modal */}
      {showOffline && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#02114A]">
          <div className="flex-1 flex flex-col w-full max-w-[430px] mx-auto overflow-hidden">
            <div className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
              <button onClick={() => setShowOffline(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <WifiOff className="w-5 h-5 text-[#295BDB]" />
              <h1 className="text-lg font-bold flex-1">{t("offlineFunctions")}</h1>
            </div>

            <div className="overflow-y-auto p-4 pt-2 space-y-4 flex-1">
              {/* Explanation */}
              <p className="text-sm text-[#F4F4F4]/60 leading-relaxed">
                {t("offlineExplanation")}
              </p>

              {/* Phrases card */}
              <div className="bg-[#0E2666] rounded-2xl p-4 border border-[#FFFFFF14] space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#295BDB]/20 flex items-center justify-center shrink-0">
                    <MessageSquarePlus className="w-5 h-5 text-[#295BDB]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#F4F4F4]">{t("offlinePhrases")}</p>
                    <p className="text-xs text-[#F4F4F4]/60 mt-0.5">{t("offlinePhrasesDesc")}</p>
                  </div>
                </div>

                {/* Status: which languages are downloaded */}
                {cachedPhraseLangs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {cachedPhraseLangs.map((code) => {
                      const lang = LANGUAGES.find((l) => l.code === code);
                      return (
                        <span key={code} className="bg-green-500/10 border border-green-500/20 text-green-400 px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          {lang?.flag} {lang?.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Download button */}
                {downloadingPhrases ? (
                  <div className="flex items-center justify-center gap-2 py-3 bg-[#295BDB]/10 rounded-xl">
                    <Loader2 className="w-4 h-4 text-[#295BDB] animate-spin" />
                    <span className="text-sm text-[#295BDB] font-medium">{t("downloading")} {downloadProgress}</span>
                  </div>
                ) : (
                  <button
                    onClick={handleDownloadAllPhrases}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#295BDB] hover:bg-[#295BDB]/80 rounded-xl text-sm font-bold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {cachedPhraseLangs.length > 0 ? t("offlineUpdate") : t("offlineDownloadAll")}
                  </button>
                )}
              </div>

              {/* Conversions card */}
              <div className="bg-[#0E2666] rounded-2xl p-4 border border-[#FFFFFF14]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#F4F4F4]">{t("offlineConversions")}</p>
                    <p className="text-xs text-green-400 mt-0.5">{t("worksOffline")}</p>
                  </div>
                </div>
              </div>

              {/* What requires internet */}
              <div className="bg-[#0E2666]/50 rounded-2xl p-4 border border-[#FFFFFF14]">
                <p className="text-xs font-bold text-[#F4F4F4]/60 mb-2">{t("offlineRequiresInternet")}</p>
                <p className="text-xs text-[#F4F4F4]/60 leading-relaxed">{t("offlineRequiresInternetDesc")}</p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#02114A]">
          <div className="flex-1 flex flex-col w-full max-w-[430px] mx-auto overflow-hidden">
            <div className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
              <button onClick={() => setShowSettings(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <Settings className="w-5 h-5 text-[#295BDB]" />
              <h1 className="text-lg font-bold flex-1">{t("settings")}</h1>
            </div>

            <div className="overflow-y-auto p-4 pt-2 space-y-6 flex-1">
              {/* Personalize */}
              {userName ? (
                <button
                  onClick={() => {
                    setTempName(userName);
                    setTempGender(userGender);
                    setTempLang(uiLanguage);
                    setTempSpeed(ttsSpeed);
                    setShowPersonalize(true);
                  }}
                  className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4 flex items-center gap-4 hover:bg-[#123182] transition-colors"
                >
                  <div className="w-11 h-11 rounded-full bg-[#295BDB]/20 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-[#295BDB]" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold text-[#F4F4F4]">{userName}</p>
                    <p className="text-xs text-[#F4F4F4]/60">{LANGUAGES.find((l) => l.code === uiLanguage)?.label}</p>
                  </div>
                  <Pencil className="w-4 h-4 text-[#F4F4F4]/60 shrink-0" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setTempName("");
                    setTempGender("");
                    setTempLang(uiLanguage);
                    setTempSpeed(ttsSpeed);
                    setShowPersonalize(true);
                  }}
                  className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 rounded-2xl p-4 flex items-center gap-4 transition-colors"
                >
                  <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold">{t("personalizeTitle")}</p>
                    <p className="text-xs text-[#F4F4F4]/60">{t("personalizeDesc")}</p>
                  </div>
                </button>
              )}

              <div className="border-t border-[#FFFFFF14]" />

              {/* System Language */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-[#F4F4F4]/60" />
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("systemLanguage")}</label>
                </div>
                <p className="text-xs text-[#F4F4F4]/60 mb-3">{t("systemLanguageDesc")}</p>
                <select
                  value={settingsLang}
                  onChange={(e) => setSettingsLang(e.target.value)}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
                >
                  <LanguageOptions />
                </select>
              </div>

              <div className="border-t border-[#FFFFFF14]" />

              {/* Favorite Languages */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-1">{t("favoriteLanguages")}</label>
                <p className="text-xs text-[#F4F4F4]/60 mb-3">{t("favoriteLanguagesDesc")}</p>
                <div className="flex flex-wrap gap-2">
                  {favoriteLanguages.map((code) => {
                    const lang = LANGUAGES.find((l) => l.code === code);
                    if (!lang) return null;
                    return (
                      <span
                        key={code}
                        className="flex items-center gap-1.5 bg-[#295BDB]/20 border border-[#295BDB] text-[#295BDB] pl-2.5 pr-1.5 py-1.5 rounded-xl text-sm font-medium"
                      >
                        {lang.flag} {lang.label}
                        <button
                          onClick={() => setFavoriteLanguages(favoriteLanguages.filter((c) => c !== code))}
                          className="p-0.5 rounded-full hover:bg-[#295BDB]/30 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    );
                  })}
                  <button
                    onClick={() => { setLangSearch(""); setShowLangPicker(true); }}
                    className="flex items-center gap-1.5 bg-[#02114A] border border-dashed border-[#FFFFFF30] text-[#F4F4F4]/60 hover:border-[#295BDB] hover:text-[#295BDB] px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Language Picker Popup */}
              {showLangPicker && (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={() => setShowLangPicker(false)}>
                  <div
                    className="w-full max-w-[430px] bg-[#0E2666] rounded-t-2xl border-t border-[#FFFFFF14] flex flex-col"
                    style={{ maxHeight: "70vh" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] shrink-0">
                      <Search className="w-4 h-4 text-[#F4F4F4]/60" />
                      <input
                        type="text"
                        value={langSearch}
                        onChange={(e) => setLangSearch(e.target.value)}
                        placeholder={t("favoriteLanguages")}
                        autoFocus
                        className="flex-1 bg-transparent text-[#F4F4F4] text-sm outline-none placeholder:text-[#F4F4F4]/60"
                      />
                      <button onClick={() => setShowLangPicker(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="overflow-y-auto p-2 flex-1">
                      {LANGUAGES.filter((l) => {
                        if (favoriteLanguages.includes(l.code)) return false;
                        if (!langSearch) return true;
                        const q = langSearch.toLowerCase();
                        return l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
                      }).map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setFavoriteLanguages([...favoriteLanguages, lang.code]);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#F4F4F4]/80 hover:bg-[#295BDB]/20 transition-colors"
                        >
                          <span className="text-base">{lang.flag}</span>
                          <span>{lang.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Voice Speed */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("voiceSpeed")}</label>
                  <span className="text-sm font-mono text-[#295BDB]">{settingsSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.1"
                  value={settingsSpeed}
                  onChange={(e) => setSettingsSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#295BDB]"
                />
                <div className="flex justify-between text-[10px] text-[#F4F4F4]/60 mt-1">
                  <span>{t("slow")}</span>
                  <span>{t("normal")}</span>
                  <span>{t("fast")}</span>
                </div>
              </div>

              {/* Voice Clone — hidden until OpenAI Custom Voices API access is granted */}

              <div className="border-t border-[#FFFFFF14]" />

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessagesSquare className="w-4 h-4 text-[#F4F4F4]/60" />
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{translationModeLabel.title}</label>
                </div>
                <p className="text-xs text-[#F4F4F4]/60 mb-3">{translationModeLabel.desc}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["auto", translationModeLabel.auto],
                    ["fast", translationModeLabel.fast],
                    ["balanced", translationModeLabel.balanced],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setSettingsTranslationPerformance(mode)}
                      className={`px-3 py-3 rounded-xl text-sm font-medium transition-colors border ${
                        settingsTranslationPerformance === mode
                          ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                          : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#FFFFFF14]" />

              <button
                onClick={handleSaveSettings}
                className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-4 rounded-xl transition-colors text-sm"
              >
                {t("save")}
              </button>

              <div className="border-t border-[#FFFFFF14]" />

              {/* About */}
              <div className="text-center space-y-3 py-2">
                <p className="text-sm font-bold text-[#F4F4F4]/80">PolyGlotAI</p>
                <p className="text-xs text-[#F4F4F4]/60">Beta 1.0.6</p>
                <div className="text-[11px] text-[#F4F4F4]/60 leading-relaxed space-y-2" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                  <p>PolyGlotAI è un prodotto sviluppato da PC8 S.r.l.<br />Il nome PolyGlotAI è un marchio di PC8 S.r.l.</p>
                  <p>Tutti i contenuti dell'app, inclusi testi, elementi grafici, interfaccia e software, sono protetti ai sensi della normativa applicabile.</p>
                  <p>© 2026 PC8 S.r.l. Tutti i diritti riservati.</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
      {/* Personalize Modal */}
      {showPersonalize && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#02114A]">
          <div className="flex-1 flex flex-col w-full max-w-[430px] mx-auto overflow-hidden">
            <div className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
              <button onClick={() => setShowPersonalize(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <User className="w-5 h-5 text-[#295BDB]" />
              <h1 className="text-lg font-bold flex-1">{t("personalizeTitle")}</h1>
            </div>

            <div className="overflow-y-auto p-4 pt-2 space-y-6 flex-1">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">{t("yourName")}</label>
                <input
                  type="text"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder={t("yourNamePlaceholder")}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] outline-none focus:ring-2 focus:ring-[#295BDB] placeholder:text-[#F4F4F4]/60"
                />
              </div>

              {/* Gender */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">{t("yourGender")}</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setTempGender("male")}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors border ${
                      tempGender === "male"
                        ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                        : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                    }`}
                  >
                    {t("genderMale")}
                  </button>
                  <button
                    onClick={() => setTempGender("female")}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors border ${
                      tempGender === "female"
                        ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                        : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                    }`}
                  >
                    {t("genderFemale")}
                  </button>
                </div>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">{t("personalizeLanguage")}</label>
                <select
                  value={tempLang}
                  onChange={(e) => setTempLang(e.target.value)}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
                >
                  <LanguageOptions />
                </select>
                {tempLang !== uiLanguage && (
                  <button
                    onClick={() => setUiLanguage(tempLang)}
                    className="mt-2 w-full p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-sm text-amber-400 hover:bg-amber-500/20 transition-colors text-left"
                  >
                    {t("switchUiLanguagePrompt")} {LANGUAGES.find((l) => l.code === tempLang)?.label || tempLang}?
                  </button>
                )}
              </div>

              {/* Voice Speed */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[#F4F4F4]/80">{t("voiceSpeed")}</label>
                  <span className="text-sm font-mono text-[#295BDB]">{tempSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.1"
                  value={tempSpeed}
                  onChange={(e) => setTempSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#295BDB]"
                />
                <div className="flex justify-between text-[10px] text-[#F4F4F4]/60 mt-1">
                  <span>{t("slow")}</span>
                  <span>{t("normal")}</span>
                  <span>{t("fast")}</span>
                </div>
              </div>

              {/* Save */}
              <button
                onClick={() => {
                  if (tempName.trim()) {
                    setUserName(tempName.trim());
                    setUserGender(tempGender);
                    setUiLanguage(tempLang);
                    setTtsSpeed(tempSpeed);
                    setShowPersonalize(false);
                  }
                }}
                disabled={!tempName.trim()}
                className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 text-[#F4F4F4] font-bold py-4 rounded-xl transition-colors text-sm"
              >
                {t("personalizeSave")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
