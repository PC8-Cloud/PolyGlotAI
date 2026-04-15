import { useUserStore } from "./store";
import { auth } from "../firebase";
import { signInAnonymously } from "firebase/auth";

export type TrialQuotaKey =
  | "conversation_ms"
  | "megaphone_ms"
  | "camera_scans"
  | "text_translate_requests";

export type TrialFeatureKey =
  | "conversation"
  | "megaphone"
  | "camera"
  | "textTranslate";

interface TrialUsageState {
  dayKey: string;
  usage: Record<TrialQuotaKey, number>;
}

const TRIAL_USAGE_STORAGE_KEY = "polyglot_trial_usage_v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_CONSUME_TIMEOUT_MS = 9000;

const TRIAL_FEATURE_LABELS = {
  it: {
    conversation: "Conversazione",
    megaphone: "Megafono",
    camera: "Fotocamera",
    textTranslate: "Traduzione testo",
  },
  en: {
    conversation: "Conversation",
    megaphone: "Megaphone",
    camera: "Camera",
    textTranslate: "Text translation",
  },
} as const;

export const TRIAL_DURATION_DAYS = 5;
export const TRIAL_DAILY_LIMITS: Record<TrialQuotaKey, number> = {
  conversation_ms: 6 * 60 * 1000,
  megaphone_ms: 6 * 60 * 1000,
  camera_scans: 8,
  text_translate_requests: 15,
};

interface TrialQuotaResult {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
}

interface TrialConsumeServerResponse {
  allowed?: boolean;
  remaining?: number;
  used?: number;
  limit?: number;
  trial?: {
    startedAt?: string | null;
    expiresAt?: string | null;
  };
}

function isDevMode(): boolean {
  return typeof import.meta !== "undefined" && Boolean((import.meta as any).env?.DEV);
}

function getTodayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getEmptyUsage(): Record<TrialQuotaKey, number> {
  return {
    conversation_ms: 0,
    megaphone_ms: 0,
    camera_scans: 0,
    text_translate_requests: 0,
  };
}

function loadUsageState(): TrialUsageState {
  if (typeof localStorage === "undefined") {
    return { dayKey: getTodayUtcKey(), usage: getEmptyUsage() };
  }
  try {
    const raw = localStorage.getItem(TRIAL_USAGE_STORAGE_KEY);
    if (!raw) return { dayKey: getTodayUtcKey(), usage: getEmptyUsage() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { dayKey: getTodayUtcKey(), usage: getEmptyUsage() };
    }
    const dayKey = String(parsed.dayKey || "");
    const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};
    return {
      dayKey: dayKey || getTodayUtcKey(),
      usage: {
        conversation_ms: Number(usage.conversation_ms) || 0,
        megaphone_ms: Number(usage.megaphone_ms) || 0,
        camera_scans: Number(usage.camera_scans) || 0,
        text_translate_requests: Number(usage.text_translate_requests) || 0,
      },
    };
  } catch {
    return { dayKey: getTodayUtcKey(), usage: getEmptyUsage() };
  }
}

function saveUsageState(state: TrialUsageState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TRIAL_USAGE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function resetLocalUsageToday() {
  const resetState = { dayKey: getTodayUtcKey(), usage: getEmptyUsage() };
  saveUsageState(resetState);
}

function setUsageForTodayKey(key: TrialQuotaKey, used: number) {
  const state = getUsageStateForToday();
  state.usage[key] = Math.max(0, Math.floor(Number(used) || 0));
  saveUsageState(state);
}

function getTrialConsumeUrl(): string | null {
  const raw = String((import.meta as any)?.env?.VITE_TRIAL_CONSUME_URL || "").trim();
  return raw || null;
}

async function ensureTrialIdentity() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.warn("[trial] Anonymous auth not available:", e);
    return null;
  }
}

async function consumeTrialQuotaServer(
  key: TrialQuotaKey,
  amount: number,
): Promise<TrialQuotaResult> {
  const url = getTrialConsumeUrl();
  if (!url) {
    throw new Error("TRIAL_SERVER_URL_MISSING");
  }

  const user = await ensureTrialIdentity();
  if (!user) {
    throw new Error("TRIAL_AUTH_UNAVAILABLE");
  }
  const token = await user.getIdToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRIAL_CONSUME_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        key,
        amount: Math.max(0, Number(amount) || 0),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`TRIAL_SERVER_HTTP_${res.status}:${text}`);
    }

    const data = (await res.json()) as TrialConsumeServerResponse;
    const limit = Number(data.limit);
    const used = Number(data.used);
    const remaining = Number(data.remaining);

    if (
      typeof data.allowed !== "boolean" ||
      !Number.isFinite(limit) ||
      !Number.isFinite(used) ||
      !Number.isFinite(remaining)
    ) {
      throw new Error("TRIAL_SERVER_INVALID_RESPONSE");
    }

    if (data.trial?.startedAt) {
      useUserStore.getState().setTrialStartedAt(data.trial.startedAt);
    }
    setUsageForTodayKey(key, used);

    return {
      allowed: data.allowed,
      remaining,
      used,
      limit,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getUsageStateForToday(): TrialUsageState {
  const todayKey = getTodayUtcKey();
  const state = loadUsageState();
  if (state.dayKey !== todayKey) {
    const resetState = { dayKey: todayKey, usage: getEmptyUsage() };
    saveUsageState(resetState);
    return resetState;
  }
  return state;
}

export function ensureTrialStarted() {
  const { plan, trialStartedAt, setTrialStartedAt } = useUserStore.getState();
  if (plan !== "free") return;
  if (isDevMode()) {
    setTrialStartedAt(new Date().toISOString());
    resetLocalUsageToday();
    return;
  }
  if (trialStartedAt) {
    if (!isDevMode() || getTrialStatus().isActive) return;
  }
  setTrialStartedAt(new Date().toISOString());
  if (isDevMode()) return;
  // Best effort: initialize trial on server as soon as app opens.
  void consumeTrialQuotaServer("conversation_ms", 0).catch(() => {
    // Keep app functional even if server quota endpoint is not configured yet.
  });
}

export function getTrialStatus() {
  const { plan, trialStartedAt } = useUserStore.getState();
  if (plan !== "free") {
    return {
      isActive: false,
      isExpired: false,
      daysRemaining: 0,
      startedAt: trialStartedAt,
      expiresAt: null as string | null,
    };
  }
  if (!trialStartedAt) {
    return {
      isActive: false,
      isExpired: false,
      daysRemaining: 0,
      startedAt: null as string | null,
      expiresAt: null as string | null,
    };
  }

  const started = new Date(trialStartedAt).getTime();
  if (!Number.isFinite(started)) {
    return {
      isActive: false,
      isExpired: true,
      daysRemaining: 0,
      startedAt: trialStartedAt,
      expiresAt: null as string | null,
    };
  }

  const expiresAtMs = started + TRIAL_DURATION_DAYS * DAY_MS;
  const now = Date.now();
  const isActive = now < expiresAtMs;
  const msLeft = Math.max(0, expiresAtMs - now);
  const daysRemaining = isActive ? Math.max(1, Math.ceil(msLeft / DAY_MS)) : 0;

  return {
    isActive,
    isExpired: !isActive,
    daysRemaining,
    startedAt: trialStartedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function isTrialActive(): boolean {
  return getTrialStatus().isActive;
}

export function getTrialRemainingDaily(key: TrialQuotaKey): number {
  const { plan } = useUserStore.getState();
  if (plan !== "free") return Number.POSITIVE_INFINITY;
  if (!isTrialActive()) return 0;
  const state = getUsageStateForToday();
  const used = state.usage[key] || 0;
  const limit = TRIAL_DAILY_LIMITS[key];
  return Math.max(0, limit - used);
}

function consumeTrialQuotaLocal(key: TrialQuotaKey, amount = 1): TrialQuotaResult {
  const { plan } = useUserStore.getState();
  const limit = TRIAL_DAILY_LIMITS[key];

  if (plan !== "free") {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
    };
  }

  if (!isTrialActive()) {
    return {
      allowed: false,
      remaining: 0,
      used: limit,
      limit,
    };
  }

  const state = getUsageStateForToday();
  const used = state.usage[key] || 0;
  const next = used + Math.max(0, amount);
  if (next > limit) {
    return {
      allowed: false,
      remaining: Math.max(0, limit - used),
      used,
      limit,
    };
  }

  state.usage[key] = next;
  saveUsageState(state);
  return {
    allowed: true,
    remaining: Math.max(0, limit - next),
    used: next,
    limit,
  };
}

export async function consumeTrialQuota(key: TrialQuotaKey, amount = 1): Promise<TrialQuotaResult> {
  const { plan } = useUserStore.getState();
  if (plan !== "free") {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
    };
  }

  if (isDevMode()) {
    return consumeTrialQuotaLocal(key, amount);
  }

  try {
    return await consumeTrialQuotaServer(key, amount);
  } catch (e) {
    console.warn("[trial] Falling back to local quota:", e);
    return consumeTrialQuotaLocal(key, amount);
  }
}

export function getTrialUpgradeMessage(
  uiLanguage: string | undefined,
  feature: TrialFeatureKey,
): string {
  const isIt = String(uiLanguage || "").toLowerCase().startsWith("it");
  if (isIt) {
    const featureLabel = TRIAL_FEATURE_LABELS.it[feature];
    return `Hai finito i limiti giornalieri di "${featureLabel}" nel trial. Passa a un piano a pagamento per continuare subito da dove hai lasciato.`;
  }
  const featureLabel = TRIAL_FEATURE_LABELS.en[feature];
  return `You used all daily trial quota for "${featureLabel}". Upgrade to continue now where you left off.`;
}
