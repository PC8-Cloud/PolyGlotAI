import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Siren,
  UtensilsCrossed,
  Hotel,
  Plane,
  MapPin,
  ShoppingBag,
  Volume2,
} from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { translateText, playTTS } from "../lib/openai";
import { savePhraseTranslations, getPhraseTranslation, isOnline } from "../lib/offline";

interface Phrase {
  emoji: string;
  key: string;
  text: string; // English canonical text for translation API
}

interface Category {
  id: string;
  icon: React.ElementType;
  labelKey: string;
  color: string;
  phrases: Phrase[];
}

const CATEGORIES: Category[] = [
  {
    id: "emergency",
    icon: Siren,
    labelKey: "catEmergency",
    color: "bg-red-600",
    phrases: [
      { emoji: "🏥", key: "pNeedDoctor", text: "I need a doctor" },
      { emoji: "🚑", key: "pCallAmbulance", text: "Call an ambulance" },
      { emoji: "🚔", key: "pCallPolice", text: "Call the police" },
      { emoji: "🆘", key: "pHelpMe", text: "Help me please" },
      { emoji: "🔥", key: "pFire", text: "There is a fire" },
      { emoji: "💊", key: "pAllergic", text: "I am allergic to..." },
      { emoji: "🤕", key: "pHurt", text: "I am hurt" },
      { emoji: "📱", key: "pEmergencyCall", text: "I need to make an emergency call" },
      { emoji: "🏨", key: "pHospital", text: "Take me to the hospital" },
      { emoji: "💉", key: "pMedication", text: "I need my medication" },
    ],
  },
  {
    id: "navigation",
    icon: MapPin,
    labelKey: "catNavigation",
    color: "bg-[#295BDB]",
    phrases: [
      { emoji: "📍", key: "pWhereIs", text: "Where is...?" },
      { emoji: "🗺️", key: "pLost", text: "I am lost" },
      { emoji: "🚕", key: "pTaxi", text: "I need a taxi" },
      { emoji: "🚉", key: "pTrainStation", text: "Where is the nearest train station?" },
      { emoji: "🚌", key: "pBusStop", text: "Where is the bus stop?" },
      { emoji: "⬅️", key: "pTurnLeft", text: "Turn left" },
      { emoji: "➡️", key: "pTurnRight", text: "Turn right" },
      { emoji: "⬆️", key: "pGoStraight", text: "Go straight" },
      { emoji: "🏠", key: "pGetToAddress", text: "How do I get to this address?" },
      { emoji: "📏", key: "pHowFar", text: "How far is it?" },
    ],
  },
  {
    id: "restaurant",
    icon: UtensilsCrossed,
    labelKey: "catRestaurant",
    color: "bg-orange-600",
    phrases: [
      { emoji: "📋", key: "pMenu", text: "The menu, please" },
      { emoji: "💧", key: "pWater", text: "Water, please" },
      { emoji: "💳", key: "pBill", text: "The bill, please" },
      { emoji: "🥜", key: "pAllergyNuts", text: "I am allergic to nuts" },
      { emoji: "🌾", key: "pAllergyGluten", text: "I am allergic to gluten" },
      { emoji: "🥛", key: "pLactose", text: "I am lactose intolerant" },
      { emoji: "🥬", key: "pVegetarian", text: "I am vegetarian" },
      { emoji: "🍽️", key: "pTableForTwo", text: "A table for two, please" },
      { emoji: "👨‍🍳", key: "pRecommend", text: "What do you recommend?" },
      { emoji: "🌶️", key: "pNotSpicy", text: "Not spicy, please" },
    ],
  },
  {
    id: "hotel",
    icon: Hotel,
    labelKey: "catHotel",
    color: "bg-purple-600",
    phrases: [
      { emoji: "🛏️", key: "pReservation", text: "I have a reservation" },
      { emoji: "🔑", key: "pRoomKey", text: "Can I have the room key?" },
      { emoji: "📶", key: "pWifi", text: "What is the WiFi password?" },
      { emoji: "🧹", key: "pCleanRoom", text: "Can you clean the room?" },
      { emoji: "⏰", key: "pWakeUp", text: "I need a wake-up call" },
      { emoji: "🚿", key: "pHotWater", text: "The hot water is not working" },
      { emoji: "🧳", key: "pLuggage", text: "Can I leave my luggage here?" },
      { emoji: "🕐", key: "pCheckout", text: "What time is checkout?" },
      { emoji: "🅿️", key: "pParking", text: "Is there parking?" },
      { emoji: "🏊", key: "pPool", text: "Where is the swimming pool?" },
    ],
  },
  {
    id: "airport",
    icon: Plane,
    labelKey: "catAirport",
    color: "bg-cyan-600",
    phrases: [
      { emoji: "🛂", key: "pPassportControl", text: "Where is passport control?" },
      { emoji: "🧳", key: "pLostLuggage", text: "I lost my luggage" },
      { emoji: "🚪", key: "pGate", text: "Where is gate...?" },
      { emoji: "⏱️", key: "pFlightDelayed", text: "My flight is delayed" },
      { emoji: "🔄", key: "pChangeFlight", text: "I need to change my flight" },
      { emoji: "💺", key: "pWindowSeat", text: "Can I have a window seat?" },
      { emoji: "🛃", key: "pNothingDeclare", text: "I have nothing to declare" },
      { emoji: "🛒", key: "pDutyFree", text: "Where is duty free?" },
      { emoji: "🚐", key: "pCityCenter", text: "How do I get to the city center?" },
      { emoji: "📄", key: "pBoardingPass", text: "Here is my boarding pass" },
    ],
  },
  {
    id: "shopping",
    icon: ShoppingBag,
    labelKey: "catShopping",
    color: "bg-emerald-600",
    phrases: [
      { emoji: "💰", key: "pHowMuch", text: "How much does this cost?" },
      { emoji: "🏷️", key: "pDiscount", text: "Is there a discount?" },
      { emoji: "👀", key: "pJustLooking", text: "I am just looking" },
      { emoji: "📐", key: "pBiggerSize", text: "Do you have a bigger size?" },
      { emoji: "🔄", key: "pReturn", text: "Can I return this?" },
      { emoji: "💳", key: "pCreditCards", text: "Do you accept credit cards?" },
      { emoji: "🧾", key: "pReceipt", text: "Can I have a receipt?" },
      { emoji: "📦", key: "pShip", text: "Can you ship this?" },
      { emoji: "🛍️", key: "pFittingRooms", text: "Where are the fitting rooms?" },
      { emoji: "💵", key: "pPayCash", text: "Can I pay in cash?" },
    ],
  },
];

export default function Phrases() {
  const navigate = useNavigate();
  const { uiLanguage, defaultSourceLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [targetLang, setTargetLang] = useState(
    defaultSourceLanguage === "en" ? "it" : defaultSourceLanguage,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [loadingPhrase, setLoadingPhrase] = useState<string | null>(null);
  const [playingPhrase, setPlayingPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePhraseClick = async (phrase: string) => {
    const key = `${phrase}__${targetLang}`;
    if (translations[key]) return; // already translated in memory

    // Check offline cache first
    const cached = getPhraseTranslation(phrase, targetLang);
    if (cached) {
      setTranslations((prev) => ({ ...prev, [key]: cached }));
      return;
    }

    if (!isOnline()) {
      setError(t("requiresInternet"));
      return;
    }

    setLoadingPhrase(phrase);
    setError(null);
    try {
      const result = await translateText(phrase, "en", [targetLang]);
      const translated = result[targetLang] || "...";
      setTranslations((prev) => ({ ...prev, [key]: translated }));
      // Cache for offline use
      savePhraseTranslations({ [key]: translated });
    } catch (e: any) {
      console.error("Translation failed:", e);
      const msg = e?.message || String(e);
      if (msg.includes("API key")) {
        setError(t("apiKeyNotConfigured"));
      } else {
        setError(msg.slice(0, 100));
      }
    } finally {
      setLoadingPhrase(null);
    }
  };

  const handleSpeak = async (text: string) => {
    setPlayingPhrase(text);
    try {
      await playTTS(text, undefined, undefined, targetLang);
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlayingPhrase(null);
    }
  };

  const activeCategory = CATEGORIES.find((c) => c.id === selectedCategory);
  const selectedLang = LANGUAGES.find((l) => l.code === targetLang);

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button
          onClick={() => {
            if (selectedCategory) setSelectedCategory(null);
            else navigate("/");
          }}
          className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold flex-1">
          {activeCategory ? t(activeCategory.labelKey as any) : t("usefulPhrases")}
        </h1>
      </header>

      {/* Language selector */}
      <div className="p-4 flex items-center gap-3 border-b border-[#FFFFFF14] bg-[#0E2666]/50">
        <span className="text-sm text-[#F4F4F4]/60">→</span>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-2.5 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-[#F4F4F4] text-xs shrink-0">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedCategory ? (
          /* Category grid */
          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`${cat.color} hover:opacity-90 rounded-2xl p-5 flex flex-col items-center gap-3 transition-all hover:scale-[1.02] shadow-lg`}
                >
                  <Icon className="w-10 h-10" />
                  <span className="text-sm font-medium">{t(cat.labelKey as any)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          /* Phrase list */
          <div className="max-w-sm mx-auto space-y-2">
            {activeCategory?.phrases.map((phrase) => {
              const key = `${phrase.text}__${targetLang}`;
              const translated = translations[key];
              const isLoading = loadingPhrase === phrase.text;
              const isPlaying = playingPhrase === translated;

              return (
                <button
                  key={phrase.text}
                  onClick={() => handlePhraseClick(phrase.text)}
                  className="w-full text-left bg-[#0E2666] rounded-2xl p-4 border border-[#FFFFFF14] hover:border-[#FFFFFF14] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{phrase.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#F4F4F4]/60">{t(phrase.key as any)}</p>
                      {isLoading ? (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-3 h-3 border-2 border-[#295BDB] border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-[#F4F4F4]/40">...</span>
                        </div>
                      ) : translated ? (
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-lg font-bold text-[#295BDB] flex-1">
                            {translated}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSpeak(translated);
                            }}
                            disabled={isPlaying}
                            className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                              isPlaying
                                ? "text-[#295BDB] animate-pulse"
                                : "text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]"
                            }`}
                          >
                            <Volume2 className="w-5 h-5" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-[#F4F4F4]/30 mt-1">
                          {selectedLang?.flag} {t("tapToTranslate")}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
