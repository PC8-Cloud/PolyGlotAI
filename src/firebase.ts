import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported, logEvent as fbLogEvent, type Analytics } from "firebase/analytics";
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckTokenRaw, type AppCheck } from "firebase/app-check";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);

// App Check: attests that requests come from the real web app (invisible
// reCAPTCHA v3), closing the trial-farming hole where any script could mint
// anonymous identities. The site key is public by design. In local dev a
// debug token is used instead — register it once in the Firebase console
// (App Check → Apps → PolyGlotWEB → Manage debug tokens) after reading it
// from the browser console.
const APPCHECK_SITE_KEY =
  (import.meta as any).env?.VITE_APPCHECK_RECAPTCHA_SITE_KEY ||
  "6LdbjHktAAAAAEIcO7cCW0dYe8BurenNWYWJ5V0w";
if ((import.meta as any).env?.DEV) {
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
let appCheck: AppCheck | null = null;
try {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} catch (e) {
  // App Check must never take the app down (e.g. exotic webviews where
  // reCAPTCHA cannot load): without enforcement requests still pass, and
  // with enforcement the backend rejects them anyway.
  console.warn("App Check init failed:", e);
}

/** Current App Check token, or null when unavailable. The API layer forwards
 *  it to Firestore/Auth REST calls so server-side entitlement checks keep
 *  working with App Check enforcement enabled. */
export async function getAppCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  try {
    const res = await getAppCheckTokenRaw(appCheck, false);
    return res.token || null;
  } catch {
    return null;
  }
}
export const db = getFirestore(app);
export const auth = getAuth(app);
export const projectId: string = firebaseConfig.projectId;

let analyticsPromise: Promise<Analytics | null> | null = null;

function getAnalyticsSafe(): Promise<Analytics | null> {
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(app) : null))
      .catch(() => null);
  }
  return analyticsPromise;
}

export function cloudFunctionUrl(name: string, region = "us-central1"): string {
  return `https://${region}-${projectId}.cloudfunctions.net/${name}`;
}

export function logEvent(name: string, params?: Record<string, string | number>) {
  void getAnalyticsSafe().then((analytics) => {
    if (!analytics) return;
    try {
      fbLogEvent(analytics, name, params);
    } catch {
      // Analytics may not be available in all environments
    }
  });
}
