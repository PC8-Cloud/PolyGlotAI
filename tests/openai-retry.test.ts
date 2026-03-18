import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the withRetry logic by extracting the pattern
// (The actual function is not exported, so we replicate the logic here for unit testing)

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 0;
      const isTransient = [429, 500, 502, 503, 529].includes(status);
      if (!isTransient || attempt === maxRetries) throw err;
      // No delay in tests
      await new Promise(r => setTimeout(r, 1));
    }
  }
  throw new Error("Unreachable");
}

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 529 overloaded and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 529, message: "Overloaded" })
      .mockResolvedValue("recovered");
    const result = await withRetry(fn);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: "Rate limited" })
      .mockRejectedValueOnce({ status: 429, message: "Rate limited" })
      .mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on 500, 502, 503 server errors", async () => {
    for (const status of [500, 502, 503]) {
      const fn = vi.fn()
        .mockRejectedValueOnce({ status, message: "Server error" })
        .mockResolvedValue("ok");
      const result = await withRetry(fn);
      expect(result).toBe("ok");
    }
  });

  it("does NOT retry on 400 bad request", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400, message: "Bad request" });
    await expect(withRetry(fn)).rejects.toEqual({ status: 400, message: "Bad request" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 401 unauthorized", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: "Invalid API key" });
    await expect(withRetry(fn)).rejects.toEqual({ status: 401, message: "Invalid API key" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 529, message: "Overloaded" });
    await expect(withRetry(fn, 2)).rejects.toEqual({ status: 529, message: "Overloaded" });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("handles errors with response.status format", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
  });

  it("does NOT retry on non-HTTP errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Network failure"));
    await expect(withRetry(fn)).rejects.toThrow("Network failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
