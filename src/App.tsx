/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { useUserStore } from "./lib/store";
import { useAutoTranslateUI } from "./lib/i18n";
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

function AutoTranslate() {
  const { uiLanguage } = useUserStore();
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    useAutoTranslateUI(uiLanguage, () => {
      forceUpdate((n) => n + 1);
    });
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
      } else if (document.visibilityState === "visible" && hiddenAtRef.current) {
        const away = Date.now() - hiddenAtRef.current;
        // If away for more than 30 seconds, reset to splash + home
        if (away > 30_000) {
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
    <div className="min-h-screen bg-[#010B2E] flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 animate-fade-in">
        <img
          src="/splash.png"
          alt="PolyGlot AI"
          className="w-64 h-auto"
        />
      </div>
    </div>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

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
        <BackgroundReset onReset={() => setShowSplash(true)} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/conversation" element={<Conversation />} />
          <Route path="/camera" element={<CameraTranslate />} />
          <Route path="/converter" element={<Converter />} />
          <Route path="/phrases" element={<Phrases />} />
          <Route path="/group" element={<GroupTranslation />} />
          <Route path="/megaphone" element={<MegaphonePage />} />
          <Route path="/room" element={<RoomHost />} />
          <Route path="/join" element={<RoomJoin />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/plans" element={<Paywall />} />
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
