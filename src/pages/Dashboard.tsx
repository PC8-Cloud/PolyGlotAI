import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, BarChart3, RefreshCw, LogIn, Plus, Loader2, Key } from "lucide-react";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } from "firebase/auth";
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

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleEmailLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) return;
    setAuthLoading(true);
    setLoginError(null);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
    } catch (e: any) {
      setLoginError(isIt ? "Email o password non validi" : "Invalid email or password");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setLoginError(null);
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
      <div className="h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col items-center justify-center font-sans p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <BarChart3 className="w-12 h-12 text-[#295BDB] mx-auto" />
            <h1 className="text-xl font-bold">{isIt ? "Accesso amministratore" : "Admin access required"}</h1>
            {user && !isAdmin ? (
              <>
                <p className="text-sm text-red-400">
                  {isIt ? "Questo account non ha i permessi di amministratore." : "This account does not have admin permissions."}
                </p>
                <p className="text-xs text-[#F4F4F4]/40 mt-1">{user.email}</p>
              </>
            ) : (
              <p className="text-sm text-[#F4F4F4]/50">
                {isIt ? "Accedi per gestire l'app" : "Sign in to manage the app"}
              </p>
            )}
          </div>

          {user && !isAdmin && (
            <button
              onClick={() => signOut(auth)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 font-medium text-sm hover:bg-red-500/30 transition-colors"
            >
              {isIt ? "Esci e accedi con un altro account" : "Sign out and use another account"}
            </button>
          )}

          {!user && (
            <>
              {loginError && (
                <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm text-center">
                  {loginError}
                </div>
              )}

              <div className="space-y-3">
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
                  onKeyDown={(e) => e.key === "Enter" && handleEmailLogin()}
                />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full bg-[#0E2666] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-sm text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:outline-none focus:border-[#295BDB]"
                  onKeyDown={(e) => e.key === "Enter" && handleEmailLogin()}
                />
                <button
                  onClick={handleEmailLogin}
                  disabled={authLoading || !loginEmail.trim() || !loginPassword}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#295BDB] text-white font-bold text-sm hover:bg-[#295BDB]/80 transition-colors disabled:opacity-50"
                >
                  {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  {isIt ? "Accedi" : "Sign in"}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#FFFFFF14]" />
                <span className="text-xs text-[#F4F4F4]/30">{isIt ? "oppure" : "or"}</span>
                <div className="flex-1 h-px bg-[#FFFFFF14]" />
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={authLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#0E2666] border border-[#FFFFFF14] text-[#F4F4F4] font-medium text-sm hover:bg-[#123182] transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {isIt ? "Accedi con Google" : "Sign in with Google"}
              </button>
            </>
          )}

          <button
            onClick={() => navigate("/")}
            className="w-full text-[#F4F4F4]/40 text-sm underline text-center"
          >
            {isIt ? "Torna all'app" : "Back to app"}
          </button>
        </div>
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
