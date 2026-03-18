import { Page } from "@playwright/test";

/** Wait for the splash screen to disappear and app content to render */
export async function waitForSplash(page: Page) {
  // The splash is 2.2s, wait a bit more for React to render
  await page.waitForTimeout(3500);
}

/** Set store values in localStorage before navigation */
export async function setupStore(page: Page, overrides: Record<string, any> = {}) {
  await page.addInitScript((data) => {
    const store = JSON.parse(localStorage.getItem("polyglot-user-storage") || '{"state":{},"version":0}');
    store.state = { ...store.state, ...data };
    localStorage.setItem("polyglot-user-storage", JSON.stringify(store));
  }, {
    openaiApiKey: "sk-test-e2e-dummy",
    ...overrides,
  });
}
