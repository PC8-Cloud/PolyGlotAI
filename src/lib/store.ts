import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PlanType = "free" | "tourist_weekly" | "tourist" | "pro" | "business";
export type TranslationPerformanceMode = "auto" | "fast" | "balanced";
export type SubscriptionStatus = "active" | "grace" | "past_due" | "canceled" | "inactive" | null;
export type PlanSource = "none" | "legacy_plan" | "server_entitlements";

interface UserState {
  userId: string | null;
  role: "HOST" | "GUEST" | null;
  displayName: string | null;
  language: string;
  uiLanguage: string;
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  favoriteLanguages: string[];
  userName: string;
  userGender: "male" | "female" | "";
  betaUnlocked: boolean;
  textModel: string;
  transcribeModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  translationPerformance: TranslationPerformanceMode;
  plan: PlanType;
  planExpiresAt: string | null;
  planStatus: SubscriptionStatus;
  planSource: PlanSource;
  planSyncedAt: string | null;
  trialStartedAt: string | null;
  customVoiceId: string | null;
  customVoiceName: string | null;
  setUserId: (id: string) => void;
  setRole: (role: "HOST" | "GUEST") => void;
  setDisplayName: (name: string) => void;
  setLanguage: (lang: string) => void;
  setUiLanguage: (lang: string) => void;
  setDefaultSourceLanguage: (lang: string) => void;
  setDefaultTargetLanguages: (langs: string[]) => void;
  setFavoriteLanguages: (langs: string[]) => void;
  setUserName: (name: string) => void;
  setUserGender: (gender: "male" | "female" | "") => void;
  setBetaUnlocked: (unlocked: boolean) => void;
  setTextModel: (model: string) => void;
  setTranscribeModel: (model: string) => void;
  setTtsModel: (model: string) => void;
  setTtsVoice: (voice: string) => void;
  setTtsSpeed: (speed: number) => void;
  setTranslationPerformance: (mode: TranslationPerformanceMode) => void;
  setPlan: (
    plan: PlanType,
    expiresAt?: string | null,
    status?: SubscriptionStatus,
    source?: PlanSource,
    syncedAt?: string | null,
  ) => void;
  setTrialStartedAt: (startedAt: string | null) => void;
  setCustomVoice: (id: string | null, name?: string | null) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      userId: null,
      role: null,
      displayName: null,
      language: "en", // default
      uiLanguage: "en", // default UI language
      defaultSourceLanguage: "en",
      defaultTargetLanguages: ["es", "fr", "it", "de"],
      favoriteLanguages: ["en", "it", "es", "fr", "de", "pt", "zh", "ar", "ja", "ru"],
      userName: "",
      userGender: "",
      betaUnlocked: false,
      textModel: "gpt-4.1-mini",
      transcribeModel: "gpt-4o-transcribe",
      ttsModel: "gpt-4o-mini-tts",
      ttsVoice: "nova",
      ttsSpeed: 1.0,
      translationPerformance: "auto",
      plan: "free",
      planExpiresAt: null,
      planStatus: null,
      planSource: "none",
      planSyncedAt: null,
      trialStartedAt: null,
      customVoiceId: null,
      customVoiceName: null,
      setUserId: (id) => set({ userId: id }),
      setRole: (role) => set({ role }),
      setDisplayName: (name) => set({ displayName: name }),
      setLanguage: (lang) => set({ language: lang }),
      setUiLanguage: (lang) => set({ uiLanguage: lang }),
      setDefaultSourceLanguage: (lang) => set({ defaultSourceLanguage: lang }),
      setDefaultTargetLanguages: (langs) => set({ defaultTargetLanguages: langs }),
      setFavoriteLanguages: (langs) => set({ favoriteLanguages: langs }),
      setUserName: (name) => set({ userName: name }),
      setUserGender: (gender) => set({ userGender: gender }),
      setBetaUnlocked: (unlocked) => set({ betaUnlocked: unlocked }),
      setTextModel: (model) => set({ textModel: model }),
      setTranscribeModel: (model) => set({ transcribeModel: model }),
      setTtsModel: (model) => set({ ttsModel: model }),
      setTtsVoice: (voice) => set({ ttsVoice: voice }),
      setTtsSpeed: (speed) => set({ ttsSpeed: speed }),
      setTranslationPerformance: (mode) => set({ translationPerformance: mode }),
      setPlan: (plan, expiresAt, status, source, syncedAt) =>
        set({
          plan,
          planExpiresAt: expiresAt || null,
          planStatus: status ?? null,
          planSource: source ?? "none",
          planSyncedAt: syncedAt || null,
        }),
      setTrialStartedAt: (startedAt) => set({ trialStartedAt: startedAt }),
      setCustomVoice: (id, name) => set({ customVoiceId: id, customVoiceName: name || null }),
    }),
    {
      name: "polyglot-user-storage",
      version: 1,
      migrate: (persistedState: unknown) => {
        if (persistedState && typeof persistedState === "object") {
          delete (persistedState as Record<string, unknown>).openaiApiKey;
        }
        return persistedState as UserState;
      },
    },
  ),
);

interface SessionState {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),
}));

// ─── Global network state (non-persisted) ────────────────────────────────────

interface NetworkState {
  isOffline: boolean;
  setIsOffline: (offline: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
  setIsOffline: (offline) => set({ isOffline: offline }),
}));
