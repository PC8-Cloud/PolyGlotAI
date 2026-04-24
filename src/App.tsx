/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { useUserStore } from "./lib/store";
import { useTranslation, useAutoTranslateUI } from "./lib/i18n";
import { stopAllAudio } from "./lib/openai";
import { logEvent } from "./firebase";
import { MessageCircle, Send, X, Star, Bug, Lightbulb, Heart, HelpCircle } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import Home from "./pages/Home";
import SessionHost from "./pages/SessionHost";
import SessionJoin from "./pages/SessionJoin";
import SessionAudience from "./pages/SessionAudience";
import Conversation from "./pages/Conversation";
import CameraTranslate from "./pages/CameraTranslate";
import Converter from "./pages/Converter";
import Phrases from "./pages/Phrases";
import GroupTranslation from "./pages/GroupTranslation";
import MegaphonePage from "./pages/Megaphone";
import RoomHost from "./pages/RoomHost";
import RoomJoin from "./pages/RoomJoin";
import Paywall from "./pages/Paywall";
import Learn from "./pages/Learn";
import NetworkCheck from "./components/NetworkCheck";
import FeatureGate from "./components/FeatureGate";
import { ensureTrialStarted } from "./lib/trial";
import { trackAppOpenDaily, trackFeatureDaily } from "./lib/metrics";
import Dashboard from "./pages/Dashboard";

function AutoTranslate() {
  const { uiLanguage } = useUserStore();
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    useAutoTranslateUI(uiLanguage, () => {
      forceUpdate((n) => n + 1);
    });
  }, [uiLanguage]);

  useEffect(() => {
    const base = String(uiLanguage || "it").toLowerCase().split("-")[0];
    document.documentElement.lang = base;
  }, [uiLanguage]);

  return null;
}

// Reset to home when returning from background
function BackgroundReset({ onReset }: { onReset: () => void }) {
  const navigate = useNavigate();
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        // Immediately stop all audio when going to background
        stopAllAudio();
      } else if (document.visibilityState === "visible" && hiddenAtRef.current) {
        const away = Date.now() - hiddenAtRef.current;
        // If away for more than 5 minutes, reset to splash + home
        if (away > 300_000) {
          onReset();
          navigate("/");
        }
        hiddenAtRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [navigate, onReset]);

  return null;
}

// Splash screen
function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="min-h-screen bg-[#010B2E] flex flex-col items-center justify-center relative">
      <div className="flex flex-col items-center gap-6 animate-fade-in">
        <img
          src="/splash.png"
          alt="PolyGlot AI"
          className="w-64 h-auto"
        />
      </div>
      <p
        className="absolute bottom-8 text-[10px] text-[#F4F4F4]/15 tracking-wide text-center"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        PolyGlotAI è un marchio di PC8 S.r.l.
      </p>
    </div>
  );
}

const BETA_PASSWORD = "beta26";

function BetaGate({ onUnlock }: { onUnlock: () => void }) {
  const { setUiLanguage } = useUserStore();
  const [lang, setLang] = useState<"it" | "en">("it");
  const t = useTranslation(lang);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const toggleLang = () => {
    const next = lang === "it" ? "en" : "it";
    setLang(next);
    setUiLanguage(next);
  };

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (password.trim().toLowerCase() === BETA_PASSWORD) {
      logEvent("beta_unlock");
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#010B2E] flex flex-col items-center justify-center p-6 text-center relative">
      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="absolute top-6 right-6 flex items-center gap-1.5 bg-[#0E2666]/80 border border-[#FFFFFF14] rounded-full px-3 py-1.5 text-sm font-medium text-[#F4F4F4]/70 hover:text-[#F4F4F4] transition-colors"
      >
        {lang === "it" ? "🇬🇧 English" : "🇮🇹 Italiano"}
      </button>

      <img src="/splash.png" alt="PolyGlotAI" className="w-48 h-auto mb-8" />
      <div className="bg-[#0E2666]/50 border border-[#FFFFFF14] rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-[#F4F4F4]">{t("betaTitle")}</h2>
        <p className="text-sm text-[#F4F4F4]/70">{t("betaSubtitle")}</p>
        <p className="text-sm text-amber-400 font-medium">{t("betaFeedback")}</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("betaPassword")}
            autoFocus
            className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-3 text-[#F4F4F4] text-center outline-none focus:ring-2 focus:ring-[#295BDB] placeholder:text-[#F4F4F4]/60"
          />
          {error && (
            <p className="text-xs text-red-400">{t("betaWrongPassword")}</p>
          )}
          <button
            type="submit"
            className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-3 rounded-xl transition-colors"
          >
            {t("betaEnter")}
          </button>
        </form>
      </div>
    </div>
  );
}

// Map routes to feature names for analytics
const ROUTE_FEATURES: Record<string, string> = {
  "/": "home",
  "/conversation": "conversation",
  "/camera": "camera",
  "/converter": "converter",
  "/phrases": "phrases",
  "/group": "group_translation",
  "/megaphone": "megaphone",
  "/room": "room_host",
  "/join": "room_join",
  "/learn": "learn",
  "/plans": "paywall",
};

// Track page views + feature usage
function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    const feature = ROUTE_FEATURES[location.pathname] || location.pathname;
    logEvent("page_view", { page: location.pathname });
    void trackFeatureDaily(feature);
    if (feature !== "home") {
      logEvent("feature_used", { feature });
    }
  }, [location.pathname]);
  return null;
}

type FeedbackCategory = "bug" | "suggestion" | "compliment" | "other";

const FEEDBACK_CATEGORIES: { id: FeedbackCategory; icon: typeof Bug; key: string }[] = [
  { id: "bug", icon: Bug, key: "feedbackCatBug" },
  { id: "suggestion", icon: Lightbulb, key: "feedbackCatSuggestion" },
  { id: "compliment", icon: Heart, key: "feedbackCatCompliment" },
  { id: "other", icon: HelpCircle, key: "feedbackCatOther" },
];

// Floating feedback button + modal
function FeedbackButton() {
  const { uiLanguage, userName } = useUserStore();
  const t = useTranslation(uiLanguage);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const resetForm = () => {
    setRating(0);
    setCategory("");
    setText("");
    setEmail("");
  };

  const handleSend = async () => {
    if (!rating && !text.trim()) return;
    setSending(true);
    try {
      await addDoc(collection(db, "feedback"), {
        rating: rating || null,
        category: category || null,
        text: text.trim() || null,
        email: email.trim() || null,
        userName: userName || null,
        uiLanguage,
        userAgent: navigator.userAgent,
        createdAt: serverTimestamp(),
      });
      logEvent("feedback_sent", { rating: rating || 0, category: category || "none" });
      setSent(true);
      setTimeout(() => {
        setOpen(false);
        resetForm();
        setSent(false);
      }, 2000);
    } catch (e) {
      console.error("Feedback send failed:", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("a11yFeedbackOpen")}
        className="fixed bottom-6 right-6 z-40 bg-[#295BDB] hover:bg-[#295BDB]/80 text-white rounded-full p-3 shadow-lg shadow-black/30 transition-all hover:scale-105"
        style={{
          bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
          right: "calc(1.5rem + env(safe-area-inset-right))",
        }}
      >
        <MessageCircle className="w-5 h-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-[430px] bg-[#0E2666] rounded-t-2xl border-t border-[#FFFFFF14] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#F4F4F4]">{t("feedbackTitle")}</h3>
              <button onClick={() => setOpen(false)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#F4F4F4]/60">{t("feedbackDesc")}</p>

            {sent ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-3xl">🎉</p>
                <p className="text-green-400 font-medium">{t("feedbackSent")}</p>
              </div>
            ) : (
              <>
                {/* Star rating */}
                <div>
                  <p className="text-xs text-[#F4F4F4]/60 mb-2">{t("feedbackRate")}</p>
                  <div className="flex gap-2 justify-center">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(n)}
                        className="p-1 transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-8 h-8 transition-colors ${
                            n <= rating
                              ? "text-amber-400 fill-amber-400"
                              : "text-[#F4F4F4]/20"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category */}
                <div className="flex gap-2">
                  {FEEDBACK_CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategory(category === cat.id ? "" : cat.id)}
                        className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-[10px] font-medium transition-colors border ${
                          category === cat.id
                            ? "bg-[#295BDB]/20 border-[#295BDB] text-[#295BDB]"
                            : "bg-[#02114A] border-[#FFFFFF14] text-[#F4F4F4]/60 hover:border-[#FFFFFF30]"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(cat.key as any)}
                      </button>
                    );
                  })}
                </div>

                {/* Text */}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("feedbackPlaceholder")}
                  rows={3}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-3 text-[#F4F4F4] text-sm outline-none focus:ring-2 focus:ring-[#295BDB] placeholder:text-[#F4F4F4]/60 resize-none"
                />

                {/* Email */}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("feedbackEmail")}
                  className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-3 text-[#F4F4F4] text-sm outline-none focus:ring-2 focus:ring-[#295BDB] placeholder:text-[#F4F4F4]/60"
                />

                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={(!rating && !text.trim()) || sending}
                  className="w-full bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-40 text-[#F4F4F4] font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {t("feedbackSend")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const { betaUnlocked, setBetaUnlocked } = useUserStore();
  const [showSplash, setShowSplash] = useState(true);

  // Log app open
  useEffect(() => {
    logEvent("app_open");
    ensureTrialStarted();
    void trackAppOpenDaily();
  }, []);

  // Beta gate (before splash)
  if (!betaUnlocked) {
    return (
      <div className="min-h-screen bg-[#010B2E] flex items-start justify-center">
        <div className="w-full max-w-[430px] min-h-screen relative shadow-2xl shadow-black/50 overflow-x-hidden">
          <BetaGate onUnlock={() => setBetaUnlocked(true)} />
        </div>
      </div>
    );
  }

  if (showSplash) {
    return (
      <div className="min-h-screen bg-[#010B2E] flex items-start justify-center">
        <div className="w-full max-w-[430px] min-h-screen relative shadow-2xl shadow-black/50 overflow-x-hidden">
          <SplashScreen onDone={() => setShowSplash(false)} />
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <AutoTranslate />
      <div className="min-h-screen bg-[#010B2E] flex items-start justify-center">
        <div className="w-full max-w-[430px] min-h-screen relative shadow-2xl shadow-black/50 overflow-x-hidden">
      <NetworkCheck />
      <BrowserRouter>
        <AnalyticsTracker />
        <BackgroundReset onReset={() => setShowSplash(true)} />
        <FeedbackButton />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/conversation" element={<FeatureGate feature="conversation"><Conversation /></FeatureGate>} />
          <Route path="/camera" element={<FeatureGate feature="camera"><CameraTranslate /></FeatureGate>} />
          <Route path="/converter" element={<Converter />} />
          <Route path="/phrases" element={<Phrases />} />
          <Route path="/group" element={<GroupTranslation />} />
          <Route path="/megaphone" element={<FeatureGate feature="megaphone"><MegaphonePage /></FeatureGate>} />
          <Route path="/room" element={<FeatureGate feature="room"><RoomHost /></FeatureGate>} />
          <Route path="/join" element={<RoomJoin />} />
          <Route path="/learn" element={<FeatureGate feature="conversation"><Learn /></FeatureGate>} />
          <Route path="/plans" element={<Paywall />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/session/:sessionId/host" element={<SessionHost />} />
          <Route path="/join/:sessionId" element={<SessionJoin />} />
          <Route
            path="/session/:sessionId/audience"
            element={<SessionAudience />}
          />
        </Routes>
      </BrowserRouter>
        </div>
      </div>
    </AuthProvider>
  );
}
