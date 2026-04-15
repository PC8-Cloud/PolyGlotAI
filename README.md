<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/981bbd8b-99ef-4c1f-9d6a-22ce84dc548c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Billing Channel (Single Codebase)

The app supports a single codebase with channel-aware billing.

- `web_pwa`: uses Stripe Checkout links (current default)
- `ios_store`: reserved for Apple In-App Purchase flow
- `android_store`: reserved for Google Play Billing flow

Set channel in `.env.local`:

```env
VITE_DISTRIBUTION_CHANNEL=web_pwa
```

For now, `ios_store` and `android_store` are scaffolded but checkout is intentionally blocked until native store billing is integrated.

Entitlements schema and Stripe webhook mapping:
- [`FIREBASE_ENTITLEMENTS.md`](./FIREBASE_ENTITLEMENTS.md)
