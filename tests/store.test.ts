import { describe, it, expect, beforeEach } from "vitest";
import { useUserStore, useSessionStore } from "../src/lib/store";

beforeEach(() => {
  useUserStore.setState({
    userId: null,
    role: null,
    displayName: null,
    language: "en",
    uiLanguage: "en",
    defaultSourceLanguage: "en",
    defaultTargetLanguages: ["es", "fr", "it", "de"],
    openaiApiKey: "",
    textModel: "gpt-4.1-mini",
    transcribeModel: "gpt-4o-transcribe",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "nova",
    ttsSpeed: 1.0,
    translationPerformance: "auto",
    plan: "free",
    planExpiresAt: null,
  });
  useSessionStore.setState({ sessionId: null });
});

describe("useUserStore", () => {
  it("has correct defaults", () => {
    const state = useUserStore.getState();
    expect(state.language).toBe("en");
    expect(state.plan).toBe("free");
    expect(state.ttsVoice).toBe("nova");
    expect(state.ttsSpeed).toBe(1.0);
    expect(state.translationPerformance).toBe("auto");
    expect(state.defaultTargetLanguages).toEqual(["es", "fr", "it", "de"]);
  });

  it("setLanguage updates language", () => {
    useUserStore.getState().setLanguage("it");
    expect(useUserStore.getState().language).toBe("it");
  });

  it("setOpenaiApiKey updates key", () => {
    useUserStore.getState().setOpenaiApiKey("sk-test123");
    expect(useUserStore.getState().openaiApiKey).toBe("sk-test123");
  });

  it("setPlan updates plan and expiry", () => {
    useUserStore.getState().setPlan("pro", "2027-01-01T00:00:00Z");
    const state = useUserStore.getState();
    expect(state.plan).toBe("pro");
    expect(state.planExpiresAt).toBe("2027-01-01T00:00:00Z");
  });

  it("setPlan with null expiry clears it", () => {
    useUserStore.getState().setPlan("pro", "2027-01-01T00:00:00Z");
    useUserStore.getState().setPlan("free");
    expect(useUserStore.getState().planExpiresAt).toBeNull();
  });

  it("setDefaultTargetLanguages replaces array", () => {
    useUserStore.getState().setDefaultTargetLanguages(["ja", "ko"]);
    expect(useUserStore.getState().defaultTargetLanguages).toEqual(["ja", "ko"]);
  });

  it("setTtsVoice and setTtsSpeed work", () => {
    useUserStore.getState().setTtsVoice("alloy");
    useUserStore.getState().setTtsSpeed(1.5);
    expect(useUserStore.getState().ttsVoice).toBe("alloy");
    expect(useUserStore.getState().ttsSpeed).toBe(1.5);
  });

  it("setTranslationPerformance updates mode", () => {
    useUserStore.getState().setTranslationPerformance("fast");
    expect(useUserStore.getState().translationPerformance).toBe("fast");
  });

  it("setUserId and setRole work", () => {
    useUserStore.getState().setUserId("user_123");
    useUserStore.getState().setRole("HOST");
    expect(useUserStore.getState().userId).toBe("user_123");
    expect(useUserStore.getState().role).toBe("HOST");
  });
});

describe("useSessionStore", () => {
  it("starts with null sessionId", () => {
    expect(useSessionStore.getState().sessionId).toBeNull();
  });

  it("setSessionId updates and clears", () => {
    useSessionStore.getState().setSessionId("session_abc");
    expect(useSessionStore.getState().sessionId).toBe("session_abc");
    useSessionStore.getState().setSessionId(null);
    expect(useSessionStore.getState().sessionId).toBeNull();
  });
});
