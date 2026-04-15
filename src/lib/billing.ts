import { openCheckout } from "./subscription";
import { getDistributionChannel, isStoreChannel, type DistributionChannel } from "./platform";

export type CheckoutPlan = "tourist_weekly" | "tourist" | "pro" | "business";
export type BillingProvider = "stripe_checkout" | "store_iap";

export function getBillingProvider(channel = getDistributionChannel()): BillingProvider {
  return isStoreChannel(channel) ? "store_iap" : "stripe_checkout";
}

export function canStartCheckout(channel = getDistributionChannel()): boolean {
  return getBillingProvider(channel) === "stripe_checkout";
}

export function getBillingHint(channel = getDistributionChannel(), uiLanguage = "en"): string {
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");
  if (channel === "ios_store") {
    return isIt
      ? "Pagamento gestito tramite acquisti in-app iOS."
      : "Payment handled via iOS in-app purchases.";
  }
  if (channel === "android_store") {
    return isIt
      ? "Pagamento gestito tramite acquisti in-app Android."
      : "Payment handled via Android in-app purchases.";
  }
  return isIt
    ? "Pagamento sicuro via Stripe Checkout (web/PWA)."
    : "Secure payment via Stripe Checkout (web/PWA).";
}

export function startCheckout(
  plan: CheckoutPlan,
  uid: string,
  email?: string,
  channel: DistributionChannel = getDistributionChannel(),
) {
  const provider = getBillingProvider(channel);

  if (provider === "stripe_checkout") {
    openCheckout(plan, uid, email);
    return;
  }

  throw new Error("STORE_BILLING_NOT_IMPLEMENTED");
}

