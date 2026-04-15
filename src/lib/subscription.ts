import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useUserStore, PlanType } from "./store";
import { isTrialActive } from "./trial";
import { parseEntitlementsFromUserDoc } from "./entitlements";

// Stripe Checkout URLs — replace with your actual Stripe payment links
export const STRIPE_LINKS = {
  tourist_weekly: "https://buy.stripe.com/14AfZh0wVgHf2Hk2Yjes004",
  tourist: "https://buy.stripe.com/bJeeVd6Vj76F5Tw1Ufes001",
  pro: "https://buy.stripe.com/8x2dR9enLdv33Lo42nes002",
  business: "https://buy.stripe.com/bJe8wP3J7dv36XA7ezes003",
};

// Stripe Customer Portal — users manage their subscription here
export const STRIPE_PORTAL_URL = "https://billing.stripe.com/p/login/YOUR_PORTAL_LINK";

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

// Open Stripe Customer Portal to manage subscription
export function openBillingPortal() {
  window.open(STRIPE_PORTAL_URL, "_blank");
}
