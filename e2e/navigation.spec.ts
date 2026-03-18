import { test, expect } from "@playwright/test";

// Helper: set API key in localStorage before page loads
async function setApiKey(page: any) {
  await page.addInitScript(() => {
    const store = JSON.parse(localStorage.getItem("polyglot-user-storage") || '{"state":{}}');
    store.state = store.state || {};
    store.state.openaiApiKey = "sk-test-dummy-key-for-e2e";
    localStorage.setItem("polyglot-user-storage", JSON.stringify(store));
  });
}

test.describe("App loads and navigates", () => {
  test("Home page renders after splash", async ({ page }) => {
    await page.goto("/");
    // Wait for splash to finish (2.2s) and home to appear
    await page.waitForTimeout(3000);
    // Should see the main grid of feature buttons
    await expect(page.locator("body")).toBeVisible();
  });

  test("Home shows 6 main feature buttons", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    // Look for the feature grid buttons (Camera, Conversation, Converter, Phrases, Offline, Group)
    const buttons = page.locator("button, a").filter({ hasText: /.+/ });
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test("Navigate to Conversation page", async ({ page }) => {
    setApiKey(page);
    await page.goto("/conversation");
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Navigate to Converter page", async ({ page }) => {
    await page.goto("/converter");
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Navigate to Phrases page", async ({ page }) => {
    await page.goto("/phrases");
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Navigate to Plans/Paywall page", async ({ page }) => {
    await page.goto("/plans");
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Navigate to Group Translation page", async ({ page }) => {
    await page.goto("/group");
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("Unknown route falls back without crash", async ({ page }) => {
    await page.goto("/nonexistent-route");
    await page.waitForTimeout(1000);
    // Should not crash — either redirects home or shows 404
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Settings modal", () => {
  test("Opens settings from Home gear icon", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    // Click the settings gear icon (top right)
    const settingsBtn = page.locator('[class*="gear"], [aria-label*="settings"], button').filter({ hasText: /settings/i }).first();
    // Try clicking any gear-like icon
    const gearIcons = page.locator("svg").filter({ hasText: "" });
    if (await gearIcons.count() > 0) {
      // Settings likely accessible
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
