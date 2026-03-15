import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useUserStore, PlanType } from "./store";

// Stripe Checkout URLs — replace with your actual Stripe payment links
export const STRIPE_LINKS = {
  tourist: "https://buy.stripe.com/YOUR_TOURIST_LINK",
  pro: "https://buy.stripe.com/YOUR_PRO_LINK",
  business: "https://buy.stripe.com/YOUR_BUSINESS_LINK",
};

// Stripe Customer Portal — users manage their subscription here
export const STRIPE_PORTAL_URL = "https://billing.stripe.com/p/login/YOUR_PORTAL_LINK";

// Plan features
export const PLAN_FEATURES = {
  free: {
    megaphone: false,
    room: false,
    conversation: true,
    camera: false,
    phrases: true,
    converter: true,
    maxRoomParticipants: 0,
  },
  tourist: {
    megaphone: true,
    room: false,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    maxRoomParticipants: 0,
  },
  pro: {
    megaphone: true,
    room: true,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    maxRoomParticipants: 20,
  },
  business: {
    megaphone: true,
    room: true,
    conversation: true,
    camera: true,
    phrases: true,
    converter: true,
    maxRoomParticipants: 100,
  },
} as const;

// Check if a plan is currently active (not expired)
export function isPlanActive(): boolean {
  const { plan, planExpiresAt } = useUserStore.getState();
  if (plan === "free") return true; // free is always "active" but limited
  if (!planExpiresAt) return false;
  return new Date(planExpiresAt) > new Date();
}

// Check if user has access to a specific feature
export function hasFeature(feature: keyof typeof PLAN_FEATURES.free): boolean {
  const { plan } = useUserStore.getState();
  const activePlan = isPlanActive() ? plan : "free";
  return !!PLAN_FEATURES[activePlan][feature];
}

// Listen to user's plan from Firestore (call once when user logs in)
export function subscribeToPlan(uid: string): () => void {
  const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
    const data = snap.data();
    if (data) {
      const plan = (data.plan as PlanType) || "free";
      const expiresAt = data.planExpiresAt?.toDate?.()?.toISOString() || data.planExpiresAt || null;
      useUserStore.getState().setPlan(plan, expiresAt);
    }
  });
  return unsub;
}

// Open Stripe Checkout for a specific plan
export function openCheckout(plan: "tourist" | "pro" | "business", uid: string, email?: string) {
  const url = new URL(STRIPE_LINKS[plan]);
  url.searchParams.set("client_reference_id", uid);
  if (email) url.searchParams.set("prefilled_email", email);
  window.open(url.toString(), "_blank");
}

// Open Stripe Customer Portal to manage subscription
export function openBillingPortal() {
  window.open(STRIPE_PORTAL_URL, "_blank");
}
