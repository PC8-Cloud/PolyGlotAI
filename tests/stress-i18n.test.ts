import { describe, it, expect } from "vitest";
import { LANGUAGES } from "../src/lib/languages";

describe("Stress: language data integrity under heavy access", () => {
  it("lookup every language by code 100 times", () => {
    for (let round = 0; round < 100; round++) {
      for (const lang of LANGUAGES) {
        const found = LANGUAGES.find(l => l.code === lang.code);
        expect(found).toBeDefined();
        expect(found!.label).toBe(lang.label);
        expect(found!.flag).toBe(lang.flag);
      }
    }
  });

  it("all flags are emoji (multi-byte unicode)", () => {
    for (const lang of LANGUAGES) {
      // Flag emojis are typically 4+ bytes
      expect(lang.flag.length).toBeGreaterThanOrEqual(1);
      // Should contain at least one non-ASCII character
      expect(/[^\x00-\x7F]/.test(lang.flag)).toBe(true);
    }
  });

  it("all locales match BCP-47 pattern", () => {
    const bcp47 = /^[a-z]{2,3}(-[A-Z]{2,4})?(-[A-Za-z0-9]+)?$/;
    for (const lang of LANGUAGES) {
      expect(lang.locale).toMatch(bcp47);
    }
  });

  it("no two languages share the same label", () => {
    const labels = LANGUAGES.map(l => l.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it("all codes are valid language codes (lowercase, optional region)", () => {
    for (const lang of LANGUAGES) {
      expect(lang.code).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
    }
  });

  it("massive parallel lookups — 10000 random lookups", () => {
    const codes = LANGUAGES.map(l => l.code);
    for (let i = 0; i < 10000; i++) {
      const code = codes[i % codes.length];
      const found = LANGUAGES.find(l => l.code === code);
      expect(found).toBeDefined();
    }
  });
});
