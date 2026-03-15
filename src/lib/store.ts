import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserState {
  userId: string | null;
  role: "HOST" | "GUEST" | null;
  displayName: string | null;
  language: string;
  uiLanguage: string;
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  openaiApiKey: string;
  textModel: string;
  transcribeModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  setUserId: (id: string) => void;
  setRole: (role: "HOST" | "GUEST") => void;
  setDisplayName: (name: string) => void;
  setLanguage: (lang: string) => void;
  setUiLanguage: (lang: string) => void;
  setDefaultSourceLanguage: (lang: string) => void;
  setDefaultTargetLanguages: (langs: string[]) => void;
  setOpenaiApiKey: (key: string) => void;
  setTextModel: (model: string) => void;
  setTranscribeModel: (model: string) => void;
  setTtsModel: (model: string) => void;
  setTtsVoice: (voice: string) => void;
  setTtsSpeed: (speed: number) => void;
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
      openaiApiKey: "",
      textModel: "gpt-4.1-mini",
      transcribeModel: "gpt-4o-transcribe",
      ttsModel: "gpt-4o-mini-tts",
      ttsVoice: "nova",
      ttsSpeed: 1.0,
      setUserId: (id) => set({ userId: id }),
      setRole: (role) => set({ role }),
      setDisplayName: (name) => set({ displayName: name }),
      setLanguage: (lang) => set({ language: lang }),
      setUiLanguage: (lang) => set({ uiLanguage: lang }),
      setDefaultSourceLanguage: (lang) => set({ defaultSourceLanguage: lang }),
      setDefaultTargetLanguages: (langs) => set({ defaultTargetLanguages: langs }),
      setOpenaiApiKey: (key) => set({ openaiApiKey: key }),
      setTextModel: (model) => set({ textModel: model }),
      setTranscribeModel: (model) => set({ transcribeModel: model }),
      setTtsModel: (model) => set({ ttsModel: model }),
      setTtsVoice: (voice) => set({ ttsVoice: voice }),
      setTtsSpeed: (speed) => set({ ttsSpeed: speed }),
    }),
    {
      name: "polyglot-user-storage",
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
