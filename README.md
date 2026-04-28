# PolyGlotAI

Real-time multilingual translation PWA — voice, text, camera, multi-participant rooms.

Stack: React 19 + Vite + TypeScript, Firebase (Auth / Firestore / Functions), Vercel serverless API for OpenAI proxying, Stripe for billing.

PolyGlotAI è un marchio di PC8 S.r.l.

## Run locally

Prerequisites: Node.js 20+.

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000`.

### Environment

Copy `.env.example` to `.env.local` and fill in:

```env
# Distribution channel (web_pwa | ios_store | android_store)
VITE_DISTRIBUTION_CHANNEL=web_pwa

# Server-side trial quota endpoint (Cloud Function URL)
VITE_TRIAL_CONSUME_URL=
```

Server-side secrets used by the Vercel API routes (`api/*.ts`) and Firebase
Functions (`functions/index.js`) are configured in their respective hosting
dashboards, not in `.env.local`:

- `OPENAI_API_KEY` — required by `api/translate.ts`, `api/transcribe.ts`,
  `api/tts.ts`, `api/analyze-image.ts`, `api/voice-clone.ts`, `api/chat.ts`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Firebase Functions secrets,
  set with `firebase functions:secrets:set`.

The Firebase web config is checked in at `src/firebase-applet-config.json`
and is safe to ship publicly (it's a public identifier, protected by
Firestore rules and Firebase Auth).

## Architecture

- `src/` — React app (pages, components, hooks).
- `src/lib/` — domain logic: store (zustand), OpenAI client, subscription /
  entitlements, trial, offline, i18n, share, PDF export.
- `api/` — Vercel serverless functions that proxy OpenAI calls. The browser
  never sees the OpenAI API key.
- `functions/` — Firebase Cloud Functions: Stripe webhook, customer portal
  session, server-side trial quota, license-key redeem, scheduled plan
  expiry sweep.
- `firestore.rules` — Firestore security rules.

## Billing channel

A single codebase serves web and (future) native stores via a
`VITE_DISTRIBUTION_CHANNEL` flag:

- `web_pwa` — Stripe Checkout links (current default).
- `ios_store` — reserved for Apple In-App Purchase.
- `android_store` — reserved for Google Play Billing.

Native channels are scaffolded; checkout is intentionally blocked for them
until store billing is integrated.

Entitlements schema and Stripe webhook mapping:
[`FIREBASE_ENTITLEMENTS.md`](./FIREBASE_ENTITLEMENTS.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 3000 |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run test:all` | Vitest + Playwright |
