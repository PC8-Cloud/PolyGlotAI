import { describe, it, expect } from "vitest";
import {
  chooseSideByText,
  languageScoreFromText,
} from "../src/lib/conversation-direction";

describe("chooseSideByText — direction never assumes strict alternation", () => {
  // The reported bug: your language = it, their = en. Speaking Italian twice in
  // a row used to flip the second turn to "them" (English side), so the model
  // was told to translate en->it on Italian text and left it untranslated.
  it("keeps consecutive Italian utterances on the 'you' side (your=it)", () => {
    const first = chooseSideByText({
      transcript: "Come stai oggi?",
      yourLang: "it",
      theirLang: "en",
      lastSide: null,
    });
    expect(first).toBe("you");

    const second = chooseSideByText({
      transcript: "Tutto bene, grazie mille",
      yourLang: "it",
      theirLang: "en",
      lastSide: "you", // previous turn was ours; must NOT flip to "them"
    });
    expect(second).toBe("you");
  });

  it("routes an English utterance to 'them' (your=it, their=en)", () => {
    const side = chooseSideByText({
      transcript: "How are you doing today?",
      yourLang: "it",
      theirLang: "en",
      lastSide: "you",
    });
    expect(side).toBe("them");
  });

  it("handles genuine alternation it -> en", () => {
    expect(
      chooseSideByText({ transcript: "Ciao, come va?", yourLang: "it", theirLang: "en", lastSide: null }),
    ).toBe("you");
    expect(
      chooseSideByText({ transcript: "I am fine, and you?", yourLang: "it", theirLang: "en", lastSide: "you" }),
    ).toBe("them");
  });
});

describe("chooseSideByText — non-Latin scripts are decided by script, not word lists", () => {
  it("detects Japanese as the configured Japanese side", () => {
    expect(
      chooseSideByText({ transcript: "こんにちは、元気ですか", yourLang: "en", theirLang: "ja", lastSide: null }),
    ).toBe("them");
    expect(
      chooseSideByText({ transcript: "こんにちは", yourLang: "ja", theirLang: "en", lastSide: "them" }),
    ).toBe("you");
  });

  it("detects Cyrillic (Russian) by script", () => {
    expect(
      chooseSideByText({ transcript: "Привет, как дела?", yourLang: "en", theirLang: "ru", lastSide: "you" }),
    ).toBe("them");
  });

  it("detects Arabic by script", () => {
    expect(
      chooseSideByText({ transcript: "مرحبا كيف حالك", yourLang: "en", theirLang: "ar", lastSide: "you" }),
    ).toBe("them");
  });
});

describe("chooseSideByText — ambiguous input keeps the current side (no blind flip)", () => {
  it("returns lastSide when there is no language signal at all", () => {
    expect(
      chooseSideByText({ transcript: "12345", yourLang: "it", theirLang: "en", lastSide: "them" }),
    ).toBe("them");
    expect(
      chooseSideByText({ transcript: "42", yourLang: "it", theirLang: "en", lastSide: "you" }),
    ).toBe("you");
  });
});

describe("languageScoreFromText", () => {
  it("scores stopwords for the matching language higher", () => {
    expect(languageScoreFromText("il gatto e il cane", "it")).toBeGreaterThan(
      languageScoreFromText("il gatto e il cane", "en"),
    );
    expect(languageScoreFromText("the cat and the dog", "en")).toBeGreaterThan(
      languageScoreFromText("the cat and the dog", "it"),
    );
  });

  it("matches accented Italian words against the accent-free hint list", () => {
    expect(languageScoreFromText("perché è tardi", "it")).toBeGreaterThan(
      languageScoreFromText("perché è tardi", "en"),
    );
  });

  it("does not score bare 'a' as English (it is an Italian preposition)", () => {
    // "a casa" is Italian; must not be pulled to the English side by "a".
    expect(languageScoreFromText("a casa", "en")).toBe(0);
  });
});
