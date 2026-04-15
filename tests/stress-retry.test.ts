import { describe, it, expect, vi } from "vitest";

// Replicate withRetry for stress testing
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 0;
      const isTransient = [429, 500, 502, 503, 529].includes(status);
      if (!isTransient || attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1)); // minimal delay in tests
    }
  }
  throw new Error("Unreachable");
}

describe("Stress: withRetry under heavy concurrent load", () => {
  it("handles 50 concurrent successful calls", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const promises = Array.from({ length: 50 }, () => withRetry(fn));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(50);
    expect(results.every(r => r === "ok")).toBe(true);
    expect(fn).toHaveBeenCalledTimes(50);
  });

  it("handles 50 sequential calls each hitting 529 once then recovering", async () => {
    const results: string[] = [];
    for (let i = 0; i < 50; i++) {
      let attempt = 0;
      const fn = vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) return Promise.reject({ status: 529, message: "Overloaded" });
        return Promise.resolve("recovered");
      });
      results.push(await withRetry(fn));
    }
    expect(results).toHaveLength(50);
    expect(results.every(r => r === "recovered")).toBe(true);
  });

  it("handles 100 concurrent calls with mixed errors", async () => {
    let i = 0;
    const fn = vi.fn().mockImplementation(() => {
      i++;
      const mod = i % 5;
      if (mod === 0) return Promise.reject({ status: 429 }); // will retry
      if (mod === 1) return Promise.reject({ status: 502 }); // will retry
      return Promise.resolve(`ok-${i}`);
    });

    // Each call may take multiple attempts, but withRetry will handle it
    // Some may exhaust retries — we expect at least some to succeed
    const promises = Array.from({ length: 100 }, () =>
      withRetry(fn, 5).catch(e => `error-${e.status}`)
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(100);
    // At least some should succeed
    const successes = results.filter(r => typeof r === "string" && r.startsWith("ok-"));
    expect(successes.length).toBeGreaterThan(0);
  });

  it("rapid fire: 200 sequential calls complete without stack overflow", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    for (let i = 0; i < 200; i++) {
      const result = await withRetry(fn);
      expect(result).toBe("ok");
    }
    expect(fn).toHaveBeenCalledTimes(200);
  });

  it("all 529s for 30 concurrent calls — all fail gracefully after retries", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 529, message: "Overloaded" });
    const promises = Array.from({ length: 30 }, () =>
      withRetry(fn, 2).catch(e => e)
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(30);
    expect(
      results.every((r) =>
        typeof r === "object" &&
        r !== null &&
        "status" in r &&
        (r as { status?: number }).status === 529
      )
    ).toBe(true);
    // Each call should have been attempted 3 times (initial + 2 retries)
    expect(fn).toHaveBeenCalledTimes(90);
  });

  it("alternating transient errors: 429 → 503 → 529 → success", async () => {
    const errors = [
      { status: 429 },
      { status: 503 },
      { status: 529 },
    ];
    let attempt = 0;
    const fn = vi.fn().mockImplementation(() => {
      if (attempt < 3) {
        const err = errors[attempt];
        attempt++;
        return Promise.reject(err);
      }
      return Promise.resolve("finally");
    });

    const result = await withRetry(fn, 5);
    expect(result).toBe("finally");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
