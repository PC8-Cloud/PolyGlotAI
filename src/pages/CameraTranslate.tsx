import React, { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Camera, RotateCcw, Volume2 } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { LANGUAGES } from "../lib/languages";
import { LanguageOptions } from "../components/LanguageOptions";
import { analyzeImage, playTTS, prepareAudioForSafari } from "../lib/openai";

export default function CameraTranslate() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const [targetLang, setTargetLang] = useState(
    uiLanguage === "en" ? "it" : "en",
  );
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<{
    objectName: string;
    translation: string;
    pronunciation?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCapture = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setCapturedImage(dataUrl);
      setResult(null);

      const base64 = dataUrl.split(",")[1];
      if (!base64) return;

      setAnalyzing(true);
      try {
        const langLabel =
          LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;
        const uiLangLabel = LANGUAGES.find((l) => l.code === uiLanguage)?.label || uiLanguage;
        const analysis = await analyzeImage(base64, langLabel, uiLangLabel);
        setResult(analysis);
      } catch (err) {
        console.error("Analysis failed:", err);
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setResult(null);
  };

  const handleSpeak = async (text: string) => {
    if (playing) return;
    prepareAudioForSafari();
    setPlaying(true);
    try {
      await playTTS(text, undefined, undefined, targetLang);
    } catch (e) {
      console.error("TTS failed:", e);
    } finally {
      setPlaying(false);
    }
  };

  const selectedLang = LANGUAGES.find((l) => l.code === targetLang);

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button
          onClick={() => navigate("/")}
          className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Camera className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("camera")}</h1>
      </header>

      {/* Language selector */}
      <div className="p-4 flex items-center gap-3 border-b border-[#FFFFFF14] bg-[#0E2666]/50">
        <span className="text-[#F4F4F4]/40 text-lg">→</span>
        <select
          value={targetLang}
          onChange={(e) => {
            setTargetLang(e.target.value);
            setResult(null);
          }}
          className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-2.5 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none text-sm"
        >
          <LanguageOptions />
        </select>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-5">
        {!capturedImage ? (
          <>
            <p className="text-[#F4F4F4]/60 text-center text-sm px-6 max-w-sm">
              {t("cameraDesc")}
            </p>
            <div className="w-full max-w-sm aspect-square bg-[#0E2666] rounded-2xl border-2 border-dashed border-[#FFFFFF14] flex flex-col items-center justify-center gap-4">
              <Camera className="w-16 h-16 text-[#F4F4F4]/30" />
            </div>

            <button
              onClick={handleCapture}
              className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-2xl ring-4 ring-[#F4F4F4]/20 hover:scale-105 transition-transform"
            >
              <Camera className="w-10 h-10 text-slate-900" />
            </button>
          </>
        ) : (
          <>
            <div className="w-full max-w-sm rounded-2xl overflow-hidden border border-[#FFFFFF14] shadow-xl relative">
              <img
                src={capturedImage}
                alt="Captured"
                className="w-full object-cover"
              />

              {analyzing && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium">
                      {t("analyzing")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className="w-full max-w-sm bg-[#0E2666] rounded-2xl p-5 border border-[#FFFFFF14] space-y-3">
                <div className="text-center">
                  <p className="text-[#F4F4F4]/60 text-sm">{t("thisIs")}</p>
                  <p className="text-xl font-bold mt-1">{result.objectName}</p>
                </div>
                <div className="border-t border-[#FFFFFF14]" />
                <div className="text-center">
                  <p className="text-[#F4F4F4]/60 text-sm flex items-center justify-center gap-1">
                    {selectedLang?.flag} {selectedLang?.label}
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-1">
                    <p className="text-3xl font-bold text-[#295BDB]">
                      {result.translation}
                    </p>
                    <button
                      onClick={() => handleSpeak(result.translation)}
                      disabled={playing}
                      className={`p-2 rounded-lg transition-colors ${
                        playing
                          ? "text-[#295BDB] animate-pulse"
                          : "text-[#F4F4F4]/40 hover:text-[#F4F4F4] hover:bg-[#123182]"
                      }`}
                    >
                      <Volume2 className="w-5 h-5" />
                    </button>
                  </div>
                  {result.pronunciation && (
                    <p className="text-[#F4F4F4]/40 text-sm mt-2 italic">
                      /{result.pronunciation}/
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={handleRetake}
              className="flex items-center gap-2 bg-[#123182] hover:bg-[#123182] px-6 py-3 rounded-xl text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t("retake")}
            </button>
          </>
        )}
      </div>

      {/* Hidden file input for camera capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
