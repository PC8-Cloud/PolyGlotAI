import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { joinSession } from "../lib/firebase-helpers";
import { useUserStore } from "../lib/store";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "../lib/i18n";
import { getLabelForCode, getLanguageByCode } from "../lib/languages";

export default function SessionJoin() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [language, setLanguage] = useState("en");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  const {
    setUserId,
    setRole,
    setDisplayName,
    setLanguage: setStoreLang,
    uiLanguage,
  } = useUserStore();
  const t = useTranslation(uiLanguage);

  useEffect(() => {
    if (!sessionId) return;
    getDoc(doc(db, "sessions", sessionId)).then((d) => {
      if (d.exists()) {
        setSession(d.data());
        if (d.data().targetLanguages && d.data().targetLanguages.length > 0) {
          setLanguage(d.data().targetLanguages[0]);
        }
      }
      setLoading(false);
    });
  }, [sessionId]);

  const handleJoin = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const participantId = await joinSession(
        sessionId,
        language,
        name || "Guest",
        "GUEST",
      );
      if (participantId) {
        setUserId(participantId);
        setRole("GUEST");
        setDisplayName(name || "Guest");
        setStoreLang(language);
        navigate(`/session/${sessionId}/audience`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex items-center justify-center">
        {t("loading")}
      </div>
    );
  if (!session)
    return (
      <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex items-center justify-center">
        Session not found
      </div>
    );

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col items-center justify-center p-6 font-sans relative">
      <div className="absolute top-6 right-6">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm bg-[#0E2666] p-8 rounded-3xl border border-[#FFFFFF14] shadow-2xl">
        <h1 className="text-2xl font-bold text-center mb-2">{session.title}</h1>
        <p className="text-[#F4F4F4]/60 text-center mb-8 text-sm">{t("ready")}</p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">
              {t("language")}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] appearance-none focus:ring-2 focus:ring-[#295BDB] outline-none"
            >
              {session.targetLanguages.map((lang: string) => {
                const langInfo = getLanguageByCode(lang);
                return (
                  <option key={lang} value={lang}>
                    {langInfo ? `${langInfo.flag} ${langInfo.label}` : lang.toUpperCase()}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#F4F4F4]/80 mb-2">
              {t("yourName")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("yourName")}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl p-4 text-[#F4F4F4] focus:ring-2 focus:ring-[#295BDB] outline-none"
            />
          </div>

          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full bg-[#295BDB] hover:bg-[#295BDB] text-[#F4F4F4] font-bold py-4 rounded-xl transition-colors mt-4 shadow-lg shadow-blue-900/20"
          >
            {t("join")}
          </button>
        </div>
      </div>
    </div>
  );
}
