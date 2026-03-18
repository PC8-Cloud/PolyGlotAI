import { test, expect } from "@playwright/test";
import { waitForSplash } from "./helpers";

test.describe("Stress: memory leak detection", () => {
  test("Heap does not grow excessively after 50 route navigations", async ({ page }) => {
    await page.goto("/");
    await waitForSplash(page);

    // Measure initial heap
    const initialMetrics = await page.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    const routes = ["/conversation", "/converter", "/phrases", "/megaphone", "/plans"];

    // Navigate through routes 50 times
    for (let i = 0; i < 50; i++) {
      const route = routes[i % routes.length];
      await page.goto(`http://localhost:3000${route}`);
      await page.waitForTimeout(200);
    }

    // Force GC if possible and measure final heap
    const finalMetrics = await page.evaluate(() => {
      if ((window as any).gc) (window as any).gc();
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return null;
    });

    if (initialMetrics && finalMetrics) {
      const growthMB = (finalMetrics - initialMetrics) / (1024 * 1024);
      console.log(`Heap growth after 50 navigations: ${growthMB.toFixed(2)} MB`);
      // Allow up to 50MB growth — anything more suggests a leak
      expect(growthMB).toBeLessThan(50);
    }

    // At minimum, app should still be alive
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Stress: console error monitoring", () => {
  test("No uncaught errors during full app navigation", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await waitForSplash(page);

    const routes = ["/conversation", "/converter", "/phrases", "/group", "/megaphone", "/plans", "/join", "/room"];

    for (const route of routes) {
      await page.goto(`http://localhost:3000${route}`);
      await page.waitForTimeout(1000);
    }

    // Filter out expected errors (API key not set, Firebase connection)
    const criticalErrors = errors.filter(e =>
      !e.includes("API key") &&
      !e.includes("Firebase") &&
      !e.includes("firestore") &&
      !e.includes("network") &&
      !e.includes("ERR_") &&
      !e.includes("auth")
    );

    console.log(`Total errors: ${errors.length}, Critical: ${criticalErrors.length}`);
    if (criticalErrors.length > 0) {
      console.log("Critical errors:", criticalErrors);
    }
    // Should have zero critical (non-API/Firebase) errors
    expect(criticalErrors.length).toBe(0);
  });
});
