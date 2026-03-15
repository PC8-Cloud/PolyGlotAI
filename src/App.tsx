/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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

export default function App() {
  return (
    <AuthProvider>
      <AutoTranslate />
      <div className="min-h-screen bg-[#010B2E] flex items-start justify-center">
        <div className="w-full max-w-[430px] min-h-screen relative shadow-2xl shadow-black/50 overflow-x-hidden">
      <BrowserRouter>
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
