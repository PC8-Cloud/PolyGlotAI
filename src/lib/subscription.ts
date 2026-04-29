import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, cloudFunctionUrl } from "../firebase";
import { useUserStore, PlanType } from "./store";
import { isTrialActive } from "./trial";
import { parseEntitlementsFromUserDoc } from "./entitlements";

function envString(key: string, fallback: string): string {
  return String((import.meta as any).env?.[key] || fallback).trim();
}

// Stripe Checkout URLs. Override per deployment with VITE_STRIPE_LINK_* env vars.
export const STRIPE_LINKS = {
  tourist_weekly: envString("VITE_STRIPE_LINK_TOURIST_WEEKLY", "https://buy.stripe.com/14AfZh0wVgHf2Hk2Yjes004"),
  tourist: envString("VITE_STRIPE_LINK_TOURIST", "https://buy.stripe.com/bJeeVd6Vj76F5Tw1Ufes001"),
  pro: envString("VITE_STRIPE_LINK_PRO", "https://buy.stripe.com/8x2dR9enLdv33Lo42nes002"),
  business: envString("VITE_STRIPE_LINK_BUSINESS", "https://buy.stripe.com/bJe8wP3J7dv36XA7ezes003"),
};

// Plan features
export interface PlanFeatures {
  megaphone: boolean;
  room: boolean;
  conversation: boolean;
  camera: boolean;
  phrases: boolean;
  converter: boolean;
  voiceClone: boolean;
  maxRoomParticipants: number;
}

export const PLAN_FEATURES: Record<PlanType, PlanFeatures> = {
  free: {
    megaphone: false,
    room: false,
    conversation: true,
    camera: false,
    phrases: true,
    converter: true,
    voiceClone: false,
    maxRoomParticipants: 0,
  },
  tourist_weekly: {
    megaphone: true,
    room: false,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    voiceClone: false,
    maxRoomParticipants: 0,
  },
  tourist: {
    megaphone: true,
    room: false,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    voiceClone: false,
    maxRoomParticipants: 0,
  },
  pro: {
    megaphone: true,
    room: true,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    voiceClone: true,
    maxRoomParticipants: 20,
  },
  business: {
    megaphone: true,
    room: true,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    voiceClone: true,
    maxRoomParticipants: 100,
  },
};

const TRIAL_FEATURES: PlanFeatures = {
  megaphone: true,
  room: false,
  conversation: true,
  camera: true,
  phrases: true,
  converter: true,
  voiceClone: false,
  maxRoomParticipants: 0,
};

// Check if a plan is currently active (not expired)
export function isPlanActive(): boolean {
  const { plan, planExpiresAt, planStatus } = useUserStore.getState();
  if (plan === "free") return true; // free is always "active" but limited
  if (planStatus === "active" || planStatus === "grace") return true;
  if (planStatus === "inactive" || planStatus === "past_due") return false;
  if (!planExpiresAt) return false;
  return new Date(planExpiresAt) > new Date();
}

// Check if user has access to a specific feature
export function hasFeature(feature: keyof typeof PLAN_FEATURES.free): boolean {
  // Optional local override (only when explicitly enabled).
  if (typeof import.meta !== "undefined" && String((import.meta as any).env?.VITE_DEV_UNLOCK_ALL_FEATURES || "").toLowerCase() === "true") {
    return true;
  }
  const { plan } = useUserStore.getState();
  const activePlan = isPlanActive() ? plan : "free";
  if (activePlan === "free" && isTrialActive()) {
    return !!TRIAL_FEATURES[feature];
  }
  return !!PLAN_FEATURES[activePlan][feature];
}

// Listen to user's entitlements from Firestore (call once when user logs in)
export function subscribeToEntitlements(uid: string): () => void {
  const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
    const data = snap.data();
    const parsed = parseEntitlementsFromUserDoc(data);
    useUserStore
      .getState()
      .setPlan(parsed.plan, parsed.planExpiresAt, parsed.planStatus, parsed.source, new Date().toISOString());
  });
  return unsub;
}

// Backward-compatible alias
export const subscribeToPlan = subscribeToEntitlements;

// Open Stripe Checkout for a specific plan
export function openCheckout(plan: "tourist_weekly" | "tourist" | "pro" | "business", uid: string, email?: string) {
  const url = new URL(STRIPE_LINKS[plan]);
  url.searchParams.set("client_reference_id", uid);
  if (email) url.searchParams.set("prefilled_email", email);
  window.open(url.toString(), "_blank");
}

// Open Stripe Customer Portal to manage subscription.
// Opens a blank tab synchronously (popup-blocker safe), then asks the
// `createPortalSession` Cloud Function for a one-time URL signed for the
// current user and redirects the tab there.
export async function openBillingPortal(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const win = window.open("", "_blank");
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(cloudFunctionUrl("createPortalSession"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || `Portal session failed (${res.status})`);
    }
    const { url } = await res.json();
    if (!url) throw new Error("Portal URL missing");
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    throw err;
  }
}
