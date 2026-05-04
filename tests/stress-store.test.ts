import { describe, it, expect, beforeEach } from "vitest";
import { useUserStore, useSessionStore } from "../src/lib/store";

beforeEach(() => {
  useUserStore.setState({
    userId: null, role: null, displayName: null,
    language: "en", uiLanguage: "en",
    defaultSourceLanguage: "en", defaultTargetLanguages: ["es", "fr", "it", "de"],
    textModel: "gpt-4.1-mini",
    transcribeModel: "gpt-4o-transcribe", ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "nova", ttsSpeed: 1.0, plan: "free", planExpiresAt: null,
  });
});

describe("Stress: rapid state updates", () => {
  it("1000 rapid language changes", () => {
    const langs = ["en", "it", "es", "fr", "de", "ja", "ko", "zh", "ar", "hi"];
    for (let i = 0; i < 1000; i++) {
      useUserStore.getState().setLanguage(langs[i % langs.length]);
    }
    expect(useUserStore.getState().language).toBe(langs[999 % langs.length]);
  });

  it("500 rapid plan changes", () => {
    const plans: Array<"free" | "tourist_weekly" | "tourist" | "pro" | "business"> =
      ["free", "tourist_weekly", "tourist", "pro", "business"];
    for (let i = 0; i < 500; i++) {
      const plan = plans[i % plans.length];
      const expiry = plan === "free" ? null : new Date(Date.now() + 86400000).toISOString();
      useUserStore.getState().setPlan(plan, expiry);
    }
    // Last plan should be the 500th (index 499 % 5 = 4 = "business")
    expect(useUserStore.getState().plan).toBe("business");
  });

  it("1000 rapid target language array replacements", () => {
    for (let i = 0; i < 1000; i++) {
      const targets = Array.from({ length: (i % 10) + 1 }, (_, j) => `lang${j}`);
      useUserStore.getState().setDefaultTargetLanguages(targets);
    }
    const final = useUserStore.getState().defaultTargetLanguages;
    expect(final).toHaveLength(10); // 999 % 10 + 1 = 10
  });

  it("concurrent reads and writes don't corrupt state", async () => {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 100; i++) {
      promises.push(
        new Promise<void>(resolve => {
          useUserStore.getState().setTtsSpeed(0.5 + (i % 20) * 0.1);
          useUserStore.getState().setTtsVoice(i % 2 === 0 ? "nova" : "alloy");
          const state = useUserStore.getState();
          expect(typeof state.ttsSpeed).toBe("number");
          expect(state.ttsSpeed).toBeGreaterThanOrEqual(0.5);
          expect(["nova", "alloy"]).toContain(state.ttsVoice);
          resolve();
        })
      );
    }

    await Promise.all(promises);
    // Final state should be consistent
    const state = useUserStore.getState();
    expect(typeof state.ttsSpeed).toBe("number");
  });

  it("rapid sessionId flipping", () => {
    for (let i = 0; i < 500; i++) {
      useSessionStore.getState().setSessionId(i % 2 === 0 ? `session-${i}` : null);
    }
    // Last iteration: 499 % 2 = 1 → null
    expect(useSessionStore.getState().sessionId).toBeNull();
  });
});

describe("Stress: subscription edge cases at scale", () => {
  it("rapidly expiring and renewing plan 100 times", () => {
    for (let i = 0; i < 100; i++) {
      // Set expired
      useUserStore.getState().setPlan("pro", new Date(Date.now() - 1000).toISOString());
      // Renew
      useUserStore.getState().setPlan("pro", new Date(Date.now() + 86400000).toISOString());
    }
    const state = useUserStore.getState();
    expect(state.plan).toBe("pro");
    expect(new Date(state.planExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });
});
