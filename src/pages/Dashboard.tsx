import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, BarChart3, RefreshCw, LogIn, Plus, Loader2, Key } from "lucide-react";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { db, auth } from "../firebase";
import { useUserStore } from "../lib/store";
import { useAuth } from "../components/AuthProvider";

const ADMIN_EMAILS = ["polyglot.app2@gmail.com"];

type UsageDoc = {
  dayKey?: string;
  deviceId?: string;
  appOpenCount?: number;
  features?: Record<string, boolean>;
  featureCounts?: Record<string, number>;
};

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return formatDayKey(d);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { uiLanguage } = useUserStore();
  const { user, ready } = useAuth();
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");
  const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email) : false;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [todayDevices, setTodayDevices] = useState(0);
  const [weekDevices, setWeekDevices] = useState(0);
  const [todayOpens, setTodayOpens] = useState(0);
  const [todayFeatureCounts, setTodayFeatureCounts] = useState<Record<string, number>>({});
  const [feedback7d, setFeedback7d] = useState(0);
  const [sessions7d, setSessions7d] = useState(0);

  // License key creation state
  const [lkCode, setLkCode] = useState("");
  const [lkPlan, setLkPlan] = useState<string>("pro");
  const [lkDays, setLkDays] = useState("");
  const [lkMaxUses, setLkMaxUses] = useState("");
  const [lkLoading, setLkLoading] = useState(false);
  const [lkResult, setLkResult] = useState<string | null>(null);

  const handleAdminLogin = async () => {
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      // user cancelled
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!lkCode.trim() || !user) return;
    setLkLoading(true);
    setLkResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `https://europe-west1-polyglot-c1941.cloudfunctions.net/createLicenseKey`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            code: lkCode.trim(),
            plan: lkPlan,
            durationDays: lkDays ? Number(lkDays) : null,
            maxUses: lkMaxUses ? Number(lkMaxUses) : null,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setLkResult(`❌ ${data.error}`);
      } else {
        setLkResult(`✅ Codice creato: ${data.code}`);
        setLkCode("");
      }
    } catch {
      setLkResult("❌ Network error");
    } finally {
      setLkLoading(false);
    }
  };

  const labels = useMemo(
    () => ({
      title: isIt ? "Dashboard Beta" : "Beta Dashboard",
      subtitle: isIt ? "Metriche uso app (Firebase)" : "App usage metrics (Firebase)",
      refresh: isIt ? "Aggiorna" : "Refresh",
      devicesToday: isIt ? "Device attivi oggi" : "Active devices today",
      devicesWeek: isIt ? "Device unici 7 giorni" : "Unique devices 7 days",
      opensToday: isIt ? "Aperture app oggi" : "App opens today",
      feedback7d: isIt ? "Feedback ultimi 7 giorni" : "Feedback last 7 days",
      sessions7d: isIt ? "Sessioni create 7 giorni" : "Sessions created 7 days",
      featuresToday: isIt ? "Feature usate oggi" : "Features used today",
      noData: isIt ? "Nessun dato disponibile" : "No data available",
      loadError: isIt ? "Errore caricamento dashboard" : "Dashboard loading error",
    }),
    [isIt]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const todayKey = daysAgoKey(0);
      const weekStartKey = daysAgoKey(6);

      const usageQ = query(
        collection(db, "app_usage_daily"),
        where("dayKey", ">=", weekStartKey),
        where("dayKey", "<=", todayKey)
      );
      const usageSnap = await getDocs(usageQ);
      const usageDocs = usageSnap.docs.map((d) => d.data() as UsageDoc);

      const todayDocs = usageDocs.filter((d) => d.dayKey === todayKey);
      const weekUniqueDevices = new Set(
        usageDocs.map((d) => String(d.deviceId || "")).filter(Boolean)
      );
      const featureMap: Record<string, number> = {};
      let opens = 0;
      for (const doc of todayDocs) {
        opens += Number(doc.appOpenCount || 0);
        const counts = doc.featureCounts || {};
        for (const [k, v] of Object.entries(counts)) {
          featureMap[k] = (featureMap[k] || 0) + Number(v || 0);
        }
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sinceTs = Timestamp.fromDate(sevenDaysAgo);

      const feedbackQ = query(collection(db, "feedback"), where("createdAt", ">=", sinceTs));
      const sessionQ = query(collection(db, "sessions"), where("createdAt", ">=", sinceTs));
      const [feedbackSnap, sessionSnap] = await Promise.all([getDocs(feedbackQ), getDocs(sessionQ)]);

      setTodayDevices(todayDocs.length);
      setWeekDevices(weekUniqueDevices.size);
      setTodayOpens(opens);
      setTodayFeatureCounts(featureMap);
      setFeedback7d(feedbackSnap.size);
      setSessions7d(sessionSnap.size);
    } catch (e: any) {
      setError(e?.message || labels.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  // ── Auth gate: not logged in ──
  if (!ready) {
    return (
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#295BDB]" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col items-center justify-center gap-6 font-sans p-6">
        <BarChart3 className="w-12 h-12 text-[#295BDB]" />
        <h1 className="text-xl font-bold">{isIt ? "Accesso amministratore" : "Admin access required"}</h1>
        <p className="text-sm text-[#F4F4F4]/50 text-center max-w-xs">
          {user && !isAdmin
            ? (isIt ? "Questo account non ha i permessi di amministratore." : "This account does not have admin permissions.")
            : (isIt ? "Accedi con il tuo account Google admin." : "Sign in with your admin Google account.")}
        </p>
        {!user && (
          <button
            onClick={handleAdminLogin}
            disabled={authLoading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#295BDB] text-white font-bold text-sm hover:bg-[#295BDB]/80 transition-colors disabled:opacity-50"
          >
            {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {isIt ? "Accedi con Google" : "Sign in with Google"}
          </button>
        )}
        <button
          onClick={() => navigate("/")}
          className="text-[#F4F4F4]/40 text-sm underline"
        >
          {isIt ? "Torna all'app" : "Back to app"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans overflow-hidden">
      <header className="flex items-center gap-3 p-4 border-b border-[#FFFFFF14] bg-[#0E2666] shrink-0">
        <button onClick={() => navigate("/")} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <BarChart3 className="w-5 h-5 text-[#295BDB]" />
        <h1 className="text-lg font-bold flex-1">{labels.title}</h1>
        <button
          onClick={load}
          className="p-2 rounded-lg text-[#F4F4F4]/60 hover:text-[#F4F4F4] hover:bg-[#123182]"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-sm text-[#F4F4F4]/60">{labels.subtitle}</p>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">
            {labels.loadError}: {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card label={labels.devicesToday} value={todayDevices} />
          <Card label={labels.devicesWeek} value={weekDevices} />
          <Card label={labels.opensToday} value={todayOpens} />
          <Card label={labels.feedback7d} value={feedback7d} />
          <Card label={labels.sessions7d} value={sessions7d} />
        </div>

        <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4">
          <h2 className="text-sm font-bold mb-3">{labels.featuresToday}</h2>
          {Object.keys(todayFeatureCounts).length === 0 ? (
            <p className="text-xs text-[#F4F4F4]/40">{labels.noData}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(todayFeatureCounts)
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .map(([feature, count]) => (
                  <div key={feature} className="flex items-center justify-between text-sm">
                    <span className="text-[#F4F4F4]/70">{feature}</span>
                    <span className="text-[#295BDB] font-mono">{count}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* License Key Creator */}
        <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-[#F59E0B]" />
            <h2 className="text-sm font-bold">{isIt ? "Crea codice licenza" : "Create license key"}</h2>
          </div>

          {lkResult && (
            <p className="text-sm p-2 rounded-lg bg-[#02114A] border border-[#FFFFFF14]">{lkResult}</p>
          )}

          <input
            type="text"
            value={lkCode}
            onChange={(e) => setLkCode(e.target.value.toUpperCase())}
            placeholder={isIt ? "Codice (es. POLYGLOT-AMICO-2026)" : "Code (e.g. POLYGLOT-FRIEND-2026)"}
            className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-3 py-2.5 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
          />

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#F4F4F4]/40 uppercase">Piano</label>
              <select
                value={lkPlan}
                onChange={(e) => setLkPlan(e.target.value)}
                className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-2 py-2 text-sm text-[#F4F4F4] focus:outline-none focus:border-[#295BDB]"
              >
                <option value="tourist_weekly">Tourist Weekly</option>
                <option value="tourist">Tourist</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#F4F4F4]/40 uppercase">{isIt ? "Giorni" : "Days"}</label>
              <input
                type="number"
                value={lkDays}
                onChange={(e) => setLkDays(e.target.value)}
                placeholder="∞"
                className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-2 py-2 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#F4F4F4]/40 uppercase">{isIt ? "Max usi" : "Max uses"}</label>
              <input
                type="number"
                value={lkMaxUses}
                onChange={(e) => setLkMaxUses(e.target.value)}
                placeholder="∞"
                className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-2 py-2 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
              />
            </div>
          </div>

          <button
            onClick={handleCreateKey}
            disabled={lkLoading || !lkCode.trim()}
            className="w-full py-2.5 rounded-xl bg-[#F59E0B] text-[#02114A] font-bold text-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {lkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isIt ? "Crea codice" : "Create code"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#0E2666] border border-[#FFFFFF14] rounded-2xl p-4">
      <p className="text-[11px] text-[#F4F4F4]/45 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black text-[#295BDB] mt-2">{value}</p>
    </div>
  );
}
