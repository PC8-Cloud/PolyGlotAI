import { describe, it, expect } from "vitest";
import { LANGUAGES, getLanguageByCode, getLocaleForCode, getLabelForCode, getPromptLanguageName } from "../src/lib/languages";

describe("LANGUAGES array", () => {
  it("has more than 100 languages", () => {
    expect(LANGUAGES.length).toBeGreaterThan(100);
  });

  it("each language has code, label, flag, locale", () => {
    for (const lang of LANGUAGES) {
      expect(lang.code).toBeTruthy();
      expect(lang.label).toBeTruthy();
      expect(lang.flag).toBeTruthy();
      expect(lang.locale).toBeTruthy();
    }
  });

  it("has no duplicate codes", () => {
    const codes = LANGUAGES.map(l => l.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("includes major world languages", () => {
    const codes = LANGUAGES.map(l => l.code);
    for (const lang of ["en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko", "ar", "hi", "ru"]) {
      expect(codes).toContain(lang);
    }
  });
});

describe("getLanguageByCode", () => {
  it("returns correct language for 'en'", () => {
    const en = getLanguageByCode("en");
    expect(en).toBeDefined();
    expect(en!.label).toContain("English");
  });

  it("returns correct language for 'it'", () => {
    const it = getLanguageByCode("it");
    expect(it).toBeDefined();
    expect(it!.label).toContain("Italian");
  });

  it("returns undefined for invalid code", () => {
    expect(getLanguageByCode("zzz")).toBeUndefined();
  });
});

describe("getLocaleForCode", () => {
  it("returns locale for known languages", () => {
    expect(getLocaleForCode("en")).toBeTruthy();
    expect(getLocaleForCode("it")).toBeTruthy();
  });
});

describe("getLabelForCode", () => {
  it("returns label for known code", () => {
    expect(getLabelForCode("en")).toContain("English");
  });

  it("returns uppercased code for unknown", () => {
    expect(getLabelForCode("zzz")).toBe("ZZZ");
  });
});

describe("getPromptLanguageName", () => {
  it("returns English-friendly names for prompt building", () => {
    expect(getPromptLanguageName("it")).toBeTruthy();
    expect(getPromptLanguageName("zh-TW")).toContain("Chinese");
  });
});
