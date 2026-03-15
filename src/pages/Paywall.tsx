import React from "react";
import { useNavigate } from "react-router-dom";
import { Check, Crown, Zap, Building2 } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { useAuth } from "../components/AuthProvider";
import { openCheckout } from "../lib/subscription";

const PLANS = [
  {
    id: "tourist" as const,
    icon: Zap,
    color: "#295BDB",
    features: ["megaphone", "conversation", "camera", "phrases", "converter"],
  },
  {
    id: "pro" as const,
    icon: Crown,
    color: "#F59E0B",
    features: ["megaphone", "conversation", "camera", "phrases", "converter", "room20"],
  },
  {
    id: "business" as const,
    icon: Building2,
    color: "#10B981",
    features: ["megaphone", "conversation", "camera", "phrases", "converter", "room100", "licenseKeys"],
  },
];

export default function Paywall() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const { user } = useAuth();

  const handleSubscribe = (plan: "tourist" | "pro" | "business") => {
    if (!user) return;
    openCheckout(plan, user.uid, user.email || undefined);
  };

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Title */}
        <div className="text-center mb-8 pt-4">
          <h1 className="text-2xl font-black mb-2">{t("choosePlan")}</h1>
          <p className="text-[#F4F4F4]/50 text-sm">{t("choosePlanDesc")}</p>
        </div>

        {/* Plans */}
        <div className="flex flex-col gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${plan.color}20` }}
                >
                  <plan.icon className="w-5 h-5" style={{ color: plan.color }} />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{t(`plan_${plan.id}`)}</h3>
                  <p className="text-sm" style={{ color: plan.color }}>{t(`plan_${plan.id}_price`)}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                {plan.features.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-sm text-[#F4F4F4]/70">
                    <Check className="w-4 h-4 text-green-400 shrink-0" />
                    <span>{t(`feature_${f}`)}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleSubscribe(plan.id)}
                className="w-full font-bold py-3 rounded-xl transition-colors text-[#F4F4F4]"
                style={{ backgroundColor: plan.color }}
              >
                {t("subscribe")}
              </button>
            </div>
          ))}
        </div>

        {/* Free tier note */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/")}
            className="text-[#F4F4F4]/40 text-sm underline"
          >
            {t("continueFree")}
          </button>
        </div>
      </div>
    </div>
  );
}
