import { describe, it, expect, beforeEach } from "vitest";
import { useUserStore } from "../src/lib/store";
import { isPlanActive, hasFeature, PLAN_FEATURES } from "../src/lib/subscription";

beforeEach(() => {
  // Reset store to defaults
  useUserStore.setState({
    plan: "free",
    planExpiresAt: null,
  });
});

describe("isPlanActive", () => {
  it("free plan is always active", () => {
    expect(isPlanActive()).toBe(true);
  });

  it("paid plan without expiry is NOT active", () => {
    useUserStore.setState({ plan: "pro", planExpiresAt: null });
    expect(isPlanActive()).toBe(false);
  });

  it("paid plan with future expiry IS active", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    useUserStore.setState({ plan: "pro", planExpiresAt: future });
    expect(isPlanActive()).toBe(true);
  });

  it("paid plan with past expiry is NOT active", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    useUserStore.setState({ plan: "pro", planExpiresAt: past });
    expect(isPlanActive()).toBe(false);
  });
});

describe("hasFeature", () => {
  it("free plan has conversation, phrases, converter", () => {
    expect(hasFeature("conversation")).toBe(true);
    expect(hasFeature("phrases")).toBe(true);
    expect(hasFeature("converter")).toBe(true);
  });

  it("free plan does NOT have megaphone, room, camera", () => {
    expect(hasFeature("megaphone")).toBe(false);
    expect(hasFeature("room")).toBe(false);
    expect(hasFeature("camera")).toBe(false);
  });

  it("pro plan has all features", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    useUserStore.setState({ plan: "pro", planExpiresAt: future });
    expect(hasFeature("megaphone")).toBe(true);
    expect(hasFeature("room")).toBe(true);
    expect(hasFeature("camera")).toBe(true);
    expect(hasFeature("conversation")).toBe(true);
  });

  it("expired pro plan falls back to free features", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    useUserStore.setState({ plan: "pro", planExpiresAt: past });
    expect(hasFeature("megaphone")).toBe(false);
    expect(hasFeature("room")).toBe(false);
    expect(hasFeature("conversation")).toBe(true);
  });

  it("tourist_weekly has camera and megaphone but NOT room", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    useUserStore.setState({ plan: "tourist_weekly", planExpiresAt: future });
    expect(hasFeature("camera")).toBe(true);
    expect(hasFeature("megaphone")).toBe(true);
    expect(hasFeature("room")).toBe(false);
  });
});

describe("PLAN_FEATURES structure", () => {
  it("all plans define all feature keys", () => {
    const featureKeys = Object.keys(PLAN_FEATURES.free);
    for (const plan of Object.keys(PLAN_FEATURES) as (keyof typeof PLAN_FEATURES)[]) {
      for (const key of featureKeys) {
        expect(PLAN_FEATURES[plan]).toHaveProperty(key);
      }
    }
  });

  it("business has highest maxRoomParticipants", () => {
    expect(PLAN_FEATURES.business.maxRoomParticipants).toBeGreaterThan(
      PLAN_FEATURES.pro.maxRoomParticipants
    );
  });
});
