import { useNavigate } from "react-router-dom";
import { ChevronLeft, Megaphone, Radio, Users } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";

export default function GroupTranslation() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  const btnClass =
    "flex flex-col items-center justify-center bg-[#123182] hover:bg-[#295BDB] active:bg-[#0E2666] rounded-2xl p-8 transition-all shadow-lg hover:scale-[1.03] border border-[#FFFFFF14] w-full";

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <header className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <Users className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{t("groupTranslation")}</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-sm mx-auto w-full">
        <button onClick={() => navigate("/megaphone")} className={btnClass}>
          <Megaphone className="w-14 h-14 mb-4" />
          <span className="text-lg font-bold">{t("megaphone")}</span>
          <p className="text-xs text-[#F4F4F4]/60 mt-2 text-center">{t("megaphoneDesc")}</p>
        </button>

        <button onClick={() => navigate("/room")} className={btnClass}>
          <Radio className="w-14 h-14 mb-4" />
          <span className="text-lg font-bold">{t("multilingualRoom")}</span>
          <p className="text-xs text-[#F4F4F4]/60 mt-2 text-center">{t("multilingualRoomDesc")}</p>
        </button>
      </div>
    </div>
  );
}
