import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, logEvent as fbLogEvent } from "firebase/analytics";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);

export function logEvent(name: string, params?: Record<string, string | number>) {
  try {
    fbLogEvent(analytics, name, params);
  } catch {
    // Analytics may not be available in all environments
  }
}
