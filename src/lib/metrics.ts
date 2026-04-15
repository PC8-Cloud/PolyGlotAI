import { doc, increment, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const DEVICE_ID_KEY = "polyglot_device_id_v1";
const SENT_KEYS_STORAGE = "polyglot_metrics_sent_v1";

function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "unknown-device";
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function wasAlreadySentToday(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const dayKey = getDayKey();
    const raw = localStorage.getItem(SENT_KEYS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : {};
    return Boolean(parsed?.[dayKey]?.[key]);
  } catch {
    return false;
  }
}

function markSentToday(key: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const dayKey = getDayKey();
    const raw = localStorage.getItem(SENT_KEYS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed[dayKey]) parsed[dayKey] = {};
    parsed[dayKey][key] = true;
    localStorage.setItem(SENT_KEYS_STORAGE, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}

async function upsertDailyUsage(feature?: string) {
  const dayKey = getDayKey();
  const deviceId = getDeviceId();
  const id = `${dayKey}_${deviceId}`;
  const ref = doc(db, "app_usage_daily", id);
  const payload: Record<string, any> = {
    dayKey,
    deviceId,
    lastSeenAt: serverTimestamp(),
    appOpenCount: increment(1),
  };
  if (feature) {
    payload[`features.${feature}`] = true;
    payload[`featureCounts.${feature}`] = increment(1);
  }
  await setDoc(
    ref,
    {
      ...payload,
      firstSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function trackAppOpenDaily() {
  if (wasAlreadySentToday("app_open")) return;
  try {
    await upsertDailyUsage("home");
    markSentToday("app_open");
  } catch {
    // best effort
  }
}

export async function trackFeatureDaily(feature: string) {
  if (!feature) return;
  const key = `feature_${feature}`;
  if (wasAlreadySentToday(key)) return;
  try {
    await upsertDailyUsage(feature);
    markSentToday(key);
  } catch {
    // best effort
  }
}

