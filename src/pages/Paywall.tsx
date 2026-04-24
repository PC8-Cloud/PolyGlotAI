import React from "react";
import { useNavigate } from "react-router-dom";
import { Check, Crown, Zap, Building2, Palmtree, Ticket, Loader2 } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";
import { useAuth } from "../components/AuthProvider";
import { canStartCheckout, getBillingHint, startCheckout } from "../lib/billing";
const PLANS = [
  {
    id: "tourist_weekly" as const,
    icon: Palmtree,
    color: "#38BDF8",
    features: ["megaphone", "conversation", "camera", "phrases", "converter"],
  },
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
    features: ["megaphone", "conversation", "camera", "phrases", "converter", "room20", "voiceClone"],
  },
  {
    id: "business" as const,
    icon: Building2,
    color: "#10B981",
    features: ["megaphone", "conversation", "camera", "phrases", "converter", "room100", "licenseKeys", "voiceClone"],
  },
];

export default function Paywall() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const { user } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const [licenseCode, setLicenseCode] = React.useState("");
  const [licenseLoading, setLicenseLoading] = React.useState(false);
  const [licenseResult, setLicenseResult] = React.useState<{ plan: string; expiresAt: string | null } | null>(null);
  const checkoutEnabled = canStartCheckout();
  const billingHint = getBillingHint(undefined, uiLanguage);
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");

  const handleRedeemCode = async () => {
    if (!user || !licenseCode.trim()) return;
    setLicenseLoading(true);
    setError(null);
    setLicenseResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `https://europe-west1-polyglot-c1941.cloudfunctions.net/redeemLicenseKey`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: licenseCode.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (isIt ? "Codice non valido" : "Invalid code"));
      } else {
        setLicenseResult({ plan: data.plan, expiresAt: data.expiresAt });
        setLicenseCode("");
      }
    } catch {
      setError(isIt ? "Errore di rete" : "Network error");
    } finally {
      setLicenseLoading(false);
    }
  };

  const handleSubscribe = (plan: "tourist_weekly" | "tourist" | "pro" | "business") => {
    if (!user) return;
    setError(null);
    try {
      startCheckout(plan, user.uid, user.email || undefined);
    } catch (e: any) {
      setError(
        isIt
          ? "Su questo canale i pagamenti in-app non sono ancora attivi."
          : "In-app purchases are not active yet on this channel.",
      );
      console.error("Checkout failed:", e);
    }
  };

  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        {/* Title */}
        <div className="text-center mb-8 pt-4">
          <h1 className="text-2xl font-black mb-2">{t("choosePlan")}</h1>
          <p className="text-[#F4F4F4]/60 text-sm">{t("choosePlanDesc")}</p>
          <p className="text-[#F4F4F4]/60 text-xs mt-2">{billingHint}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

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
                    <span>{t(`feature_${f}` as any)}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={!checkoutEnabled}
                className="w-full font-bold py-3 rounded-xl transition-colors text-[#F4F4F4]"
                style={{
                  backgroundColor: checkoutEnabled ? plan.color : "#46516E",
                  opacity: checkoutEnabled ? 1 : 0.65,
                }}
              >
                {t("subscribe")}
              </button>
            </div>
          ))}
        </div>

        {/* License code */}
        <div className="mt-6 bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-[#F59E0B]" />
            <h3 className="font-bold text-sm">{isIt ? "Hai un codice?" : "Have a code?"}</h3>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
              placeholder={isIt ? "Inserisci codice licenza" : "Enter license code"}
              className="flex-1 bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
            />
            <button
              onClick={handleRedeemCode}
              disabled={licenseLoading || !licenseCode.trim()}
              className="px-4 py-2.5 rounded-xl bg-[#F59E0B] text-[#02114A] font-bold text-sm disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {licenseLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isIt ? "Attiva" : "Redeem"}
            </button>
          </div>
        </div>

        {/* Free tier note */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/")}
            className="text-[#F4F4F4]/60 text-sm underline"
          >
            {t("continueFree")}
          </button>
        </div>
      </div>

      {/* License activation success popup */}
      {licenseResult && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="w-full max-w-sm bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-6 space-y-5 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-lg font-bold">
              {isIt ? "Codice attivato!" : "Code activated!"}
            </h2>
            <p className="text-sm text-[#F4F4F4]/70 leading-relaxed">
              {isIt
                ? `Hai inserito un codice che ti autorizza ad usare la versione ${licenseResult.plan.charAt(0).toUpperCase() + licenseResult.plan.slice(1).replace("_", " ")} di PolyGlotAI${licenseResult.expiresAt ? ` fino al ${new Date(licenseResult.expiresAt).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}` : " senza scadenza"}.`
                : `Your code unlocks the ${licenseResult.plan.charAt(0).toUpperCase() + licenseResult.plan.slice(1).replace("_", " ")} version of PolyGlotAI${licenseResult.expiresAt ? ` until ${new Date(licenseResult.expiresAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}` : " permanently"}.`}
            </p>
            <button
              onClick={() => navigate("/")}
              className="w-full py-3 rounded-xl bg-[#295BDB] hover:bg-[#295BDB]/80 text-white font-bold text-sm transition-colors"
            >
              {isIt ? "Torna all'app" : "Back to app"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
