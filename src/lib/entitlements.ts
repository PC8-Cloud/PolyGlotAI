import type { PlanSource, PlanType, SubscriptionStatus } from "./store";

export interface ParsedEntitlements {
  plan: PlanType;
  planExpiresAt: string | null;
  planStatus: SubscriptionStatus;
  source: PlanSource;
}

const VALID_PLANS: PlanType[] = ["free", "tourist_weekly", "tourist", "pro", "business"];

function normalizePlan(raw: unknown): PlanType {
  const value = String(raw || "").trim().toLowerCase();
  return (VALID_PLANS as string[]).includes(value) ? (value as PlanType) : "free";
}

function normalizeStatus(raw: unknown): SubscriptionStatus {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "active") return "active";
  if (value === "grace") return "grace";
  if (value === "past_due") return "past_due";
  if (value === "canceled") return "canceled";
  if (value === "inactive") return "inactive";
  return null;
}

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (raw?.toDate && typeof raw.toDate === "function") {
    try {
      return raw.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw.toISOString() : null;
  }
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

export function parseEntitlementsFromUserDoc(data: any): ParsedEntitlements {
  if (!data || typeof data !== "object") {
    return {
      plan: "free",
      planExpiresAt: null,
      planStatus: null,
      source: "none",
    };
  }

  const ent = data.entitlements && typeof data.entitlements === "object" ? data.entitlements : null;
  if (ent) {
    return {
      plan: normalizePlan(ent.plan ?? ent.tier),
      planExpiresAt: toIso(ent.expiresAt ?? ent.expires_at),
      planStatus: normalizeStatus(ent.status),
      source: "server_entitlements",
    };
  }

  return {
    plan: normalizePlan(data.plan),
    planExpiresAt: toIso(data.planExpiresAt),
    planStatus: normalizeStatus(data.planStatus),
    source: "legacy_plan",
  };
}

