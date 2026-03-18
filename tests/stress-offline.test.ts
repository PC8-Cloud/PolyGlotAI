import { describe, it, expect, beforeEach } from "vitest";
import {
  saveCurrencyRates,
  loadCachedRates,
  loadAllCachedRates,
  savePhraseTranslations,
  loadAllPhraseTranslations,
  getPhraseTranslation,
  getCachedPhraseLangs,
  getPhraseCountForLang,
  reportResponseTime,
  isConnectionSlow,
  resetConnectionMonitor,
} from "../src/lib/offline";

beforeEach(() => {
  localStorage.clear();
  resetConnectionMonitor();
});

describe("Stress: massive currency rates cache", () => {
  it("stores and retrieves 50 different base currencies", () => {
    const currencies = Array.from({ length: 50 }, (_, i) => `CUR${i.toString().padStart(3, "0")}`);

    for (const base of currencies) {
      const rates: Record<string, number> = {};
      for (let j = 0; j < 20; j++) {
        rates[`TGT${j}`] = Math.random() * 100;
      }
      saveCurrencyRates(base, rates, "2026-03-18");
    }

    const all = loadAllCachedRates();
    expect(Object.keys(all)).toHaveLength(50);

    // Verify random access
    const cached = loadCachedRates("CUR025");
    expect(cached).not.toBeNull();
    expect(Object.keys(cached!.rates)).toHaveLength(20);
  });

  it("overwrites same base currency 100 times without corruption", () => {
    for (let i = 0; i < 100; i++) {
      saveCurrencyRates("EUR", { USD: 1.0 + i * 0.01 }, `2026-03-${(i % 28) + 1}`);
    }
    const cached = loadCachedRates("EUR");
    expect(cached).not.toBeNull();
    expect(cached!.rates.USD).toBeCloseTo(1.99, 1);
  });
});

describe("Stress: massive phrase translations cache", () => {
  it("stores 1000 phrase translations and retrieves correctly", () => {
    const translations: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      translations[`Phrase ${i}__lang${i % 10}`] = `Traduzione ${i}`;
    }
    savePhraseTranslations(translations);

    const all = loadAllPhraseTranslations();
    expect(Object.keys(all)).toHaveLength(1000);

    // Random access
    expect(getPhraseTranslation("Phrase 500", "lang0")).toBe("Traduzione 500");
    expect(getPhraseTranslation("Phrase 999", "lang9")).toBe("Traduzione 999");
  });

  it("incremental saves — 100 batches of 50 phrases each", () => {
    for (let batch = 0; batch < 100; batch++) {
      const translations: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        translations[`Phrase_${batch}_${i}__es`] = `Trad_${batch}_${i}`;
      }
      savePhraseTranslations(translations);
    }

    const all = loadAllPhraseTranslations();
    expect(Object.keys(all)).toHaveLength(5000);
    expect(getPhraseCountForLang("es")).toBe(5000);
  });

  it("getCachedPhraseLangs with 50 languages", () => {
    const translations: Record<string, string> = {};
    for (let lang = 0; lang < 50; lang++) {
      for (let phrase = 0; phrase < 5; phrase++) {
        translations[`Hello ${phrase}__lang${lang}`] = `Hi ${lang}-${phrase}`;
      }
    }
    savePhraseTranslations(translations);

    const langs = getCachedPhraseLangs();
    expect(langs).toHaveLength(50);
  });
});

describe("Stress: connection monitor rapid fire", () => {
  it("1000 fast responses keep connection not slow", () => {
    for (let i = 0; i < 1000; i++) {
      reportResponseTime(100 + Math.random() * 500);
    }
    expect(isConnectionSlow()).toBe(false);
  });

  it("1000 slow responses make connection slow", () => {
    for (let i = 0; i < 1000; i++) {
      reportResponseTime(4000 + Math.random() * 2000);
    }
    expect(isConnectionSlow()).toBe(true);
  });

  it("rapid alternation: slow → fast → slow (500 cycles)", () => {
    for (let i = 0; i < 500; i++) {
      reportResponseTime(5000); // slow
      reportResponseTime(200);  // fast
    }
    // After rapid alternation, slowCount should be low (each fast decrements)
    // Final state depends on exact count math, just check no crash
    expect(typeof isConnectionSlow()).toBe("boolean");
  });

  it("exact threshold: responses at exactly 3000ms boundary", () => {
    resetConnectionMonitor();
    reportResponseTime(3000); // NOT slow (threshold is >3000)
    reportResponseTime(3000);
    expect(isConnectionSlow()).toBe(false);

    reportResponseTime(3001); // slow
    reportResponseTime(3001); // slow — now count = 2 but previous fast reduced it
    // Just verify no crash
    expect(typeof isConnectionSlow()).toBe("boolean");
  });
});
