import { describe, it, expect, beforeEach } from "vitest";
import {
  saveCurrencyRates,
  loadCachedRates,
  loadAllCachedRates,
  getLastRateDate,
  savePhraseTranslations,
  loadAllPhraseTranslations,
  getPhraseTranslation,
  getCachedPhraseLangs,
  getPhraseCountForLang,
  getCachedUILanguages,
  isOnline,
  reportResponseTime,
  isConnectionSlow,
  resetConnectionMonitor,
  getLastResponseTime,
} from "../src/lib/offline";

beforeEach(() => {
  localStorage.clear();
  resetConnectionMonitor();
});

// ─── Currency Rates ──────────────────────────────────────────────────────────

describe("Currency rates cache", () => {
  it("saves and loads rates by base currency", () => {
    saveCurrencyRates("EUR", { USD: 1.1, GBP: 0.85 }, "2026-03-18");
    const cached = loadCachedRates("EUR");
    expect(cached).not.toBeNull();
    expect(cached!.base).toBe("EUR");
    expect(cached!.rates.USD).toBe(1.1);
    expect(cached!.rates.GBP).toBe(0.85);
    expect(cached!.date).toBe("2026-03-18");
  });

  it("returns null for non-cached base", () => {
    expect(loadCachedRates("JPY")).toBeNull();
  });

  it("stores multiple base currencies independently", () => {
    saveCurrencyRates("EUR", { USD: 1.1 }, "2026-03-18");
    saveCurrencyRates("USD", { EUR: 0.9 }, "2026-03-18");
    const all = loadAllCachedRates();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.EUR.rates.USD).toBe(1.1);
    expect(all.USD.rates.EUR).toBe(0.9);
  });

  it("getLastRateDate returns most recent", () => {
    saveCurrencyRates("EUR", { USD: 1.1 }, "2026-03-17");
    saveCurrencyRates("USD", { EUR: 0.9 }, "2026-03-18");
    const last = getLastRateDate();
    expect(last).not.toBeNull();
  });

  it("getLastRateDate returns null when empty", () => {
    expect(getLastRateDate()).toBeNull();
  });
});

// ─── Phrases ─────────────────────────────────────────────────────────────────

describe("Phrase translations cache", () => {
  it("saves and retrieves phrase translations", () => {
    savePhraseTranslations({ "Hello__es": "Hola", "Hello__it": "Ciao" });
    expect(getPhraseTranslation("Hello", "es")).toBe("Hola");
    expect(getPhraseTranslation("Hello", "it")).toBe("Ciao");
    expect(getPhraseTranslation("Hello", "fr")).toBeNull();
  });

  it("merges new translations with existing", () => {
    savePhraseTranslations({ "Hello__es": "Hola" });
    savePhraseTranslations({ "Goodbye__es": "Adiós" });
    const all = loadAllPhraseTranslations();
    expect(Object.keys(all)).toHaveLength(2);
  });

  it("getCachedPhraseLangs returns unique languages", () => {
    savePhraseTranslations({
      "Hello__es": "Hola",
      "Goodbye__es": "Adiós",
      "Hello__it": "Ciao",
    });
    const langs = getCachedPhraseLangs();
    expect(langs).toContain("es");
    expect(langs).toContain("it");
    expect(langs).toHaveLength(2);
  });

  it("getPhraseCountForLang counts correctly", () => {
    savePhraseTranslations({
      "Hello__es": "Hola",
      "Goodbye__es": "Adiós",
      "Hello__it": "Ciao",
    });
    expect(getPhraseCountForLang("es")).toBe(2);
    expect(getPhraseCountForLang("it")).toBe(1);
    expect(getPhraseCountForLang("fr")).toBe(0);
  });
});

// ─── UI Language cache ───────────────────────────────────────────────────────

describe("UI language cache", () => {
  it("detects cached UI languages by key prefix", () => {
    localStorage.setItem("polyglot-ui-it", '{"hello":"Ciao"}');
    localStorage.setItem("polyglot-ui-es", '{"hello":"Hola"}');
    localStorage.setItem("other-key", "irrelevant");
    const langs = getCachedUILanguages();
    expect(langs).toContain("it");
    expect(langs).toContain("es");
    expect(langs).not.toContain("other-key");
  });
});

// ─── Connection monitor ──────────────────────────────────────────────────────

describe("Connection quality monitor", () => {
  it("starts as not slow", () => {
    expect(isConnectionSlow()).toBe(false);
  });

  it("becomes slow after consecutive slow responses", () => {
    reportResponseTime(4000); // slow
    expect(isConnectionSlow()).toBe(false); // need 2
    reportResponseTime(4000); // slow again
    expect(isConnectionSlow()).toBe(true);
  });

  it("recovers after fast responses", () => {
    reportResponseTime(4000);
    reportResponseTime(4000);
    expect(isConnectionSlow()).toBe(true);
    reportResponseTime(500); // fast
    reportResponseTime(500); // fast
    expect(isConnectionSlow()).toBe(false);
  });

  it("tracks last response time", () => {
    reportResponseTime(1234);
    expect(getLastResponseTime()).toBe(1234);
  });

  it("resets properly", () => {
    reportResponseTime(5000);
    reportResponseTime(5000);
    resetConnectionMonitor();
    expect(isConnectionSlow()).toBe(false);
    expect(getLastResponseTime()).toBe(0);
  });
});

// ─── Online check ────────────────────────────────────────────────────────────

describe("isOnline", () => {
  it("returns navigator.onLine value", () => {
    expect(isOnline()).toBe(true);
  });
});
