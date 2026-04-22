import React, { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { hasFeature, PLAN_FEATURES } from "../lib/subscription";

interface FeatureGateProps {
  feature: keyof typeof PLAN_FEATURES.free;
  children: ReactNode;
}

export default function FeatureGate({ feature, children }: FeatureGateProps) {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-20 h-20 rounded-full bg-[#295BDB]/20 flex items-center justify-center">
          <Lock className="w-10 h-10 text-[#295BDB]" />
        </div>
        <h2 className="text-xl font-bold text-center">{t("upgradeRequired")}</h2>
        <p className="text-[#F4F4F4]/60 text-sm text-center px-8">{t("upgradeRequiredDesc")}</p>
        <button
          onClick={() => navigate("/plans")}
          className="bg-[#295BDB] hover:bg-[#295BDB]/80 text-[#F4F4F4] font-bold py-3 px-8 rounded-xl transition-colors"
        >
          {t("upgradePlan")}
        </button>
      </div>
    </div>
  );
}
