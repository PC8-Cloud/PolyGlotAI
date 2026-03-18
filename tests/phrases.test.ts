import { describe, it, expect } from "vitest";
import { ALL_PHRASE_TEXTS } from "../src/lib/phrases-data";

describe("ALL_PHRASE_TEXTS", () => {
  it("has at least 50 phrases", () => {
    expect(ALL_PHRASE_TEXTS.length).toBeGreaterThanOrEqual(50);
  });

  it("contains no duplicates", () => {
    const unique = new Set(ALL_PHRASE_TEXTS);
    expect(unique.size).toBe(ALL_PHRASE_TEXTS.length);
  });

  it("all are non-empty strings", () => {
    for (const text of ALL_PHRASE_TEXTS) {
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it("includes key emergency phrases", () => {
    expect(ALL_PHRASE_TEXTS).toContain("I need a doctor");
    expect(ALL_PHRASE_TEXTS).toContain("Call an ambulance");
    expect(ALL_PHRASE_TEXTS).toContain("Help me please");
  });

  it("includes navigation phrases", () => {
    expect(ALL_PHRASE_TEXTS).toContain("I am lost");
    expect(ALL_PHRASE_TEXTS).toContain("I need a taxi");
  });

  it("includes restaurant phrases", () => {
    expect(ALL_PHRASE_TEXTS).toContain("The menu, please");
    expect(ALL_PHRASE_TEXTS).toContain("The bill, please");
  });

  it("includes hotel phrases", () => {
    expect(ALL_PHRASE_TEXTS).toContain("I have a reservation");
  });
});
