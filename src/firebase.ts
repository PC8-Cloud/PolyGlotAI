import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported, logEvent as fbLogEvent, type Analytics } from "firebase/analytics";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
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
