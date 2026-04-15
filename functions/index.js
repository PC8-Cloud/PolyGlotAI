const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

// Secrets — set these with: firebase functions:secrets:set STRIPE_SECRET_KEY
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Plan mapping: Stripe Price ID → PolyGlot plan name
// Update these after creating products in Stripe Dashboard
// TODO: Replace with actual Stripe Price IDs (find them in Stripe Dashboard → each product → Pricing section)
// Product IDs for reference:
// Tourist Weekly: prod_U9fYGH1wm37kad
// Tourist:        prod_U9fZcf4G3ilSDM
// Pro:            prod_U9faR6uaTtvhkK
// Business:       prod_U9fbdJFO8lCutl
const PRICE_TO_PLAN = {
  "price_1TBMD0FMY3pYKHOxGEX1KFSx": "tourist_weekly",
  "price_1TBMELFMY3pYKHOxiB3PP3Uy": "tourist",
  "price_1TBMFOFMY3pYKHOxzK4r2qUF": "pro",
  "price_1TBMGeFMY3pYKHOx5DdCzOPH": "business",
};

const TRIAL_DURATION_DAYS = 5;
const TRIAL_DAILY_LIMITS = {
  conversation_ms: 6 * 60 * 1000,
  megaphone_ms: 6 * 60 * 1000,
  camera_scans: 8,
  text_translate_requests: 15,
};

function todayUtcKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toDateValue(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof raw?.toDate === "function") {
    try {
      const d = raw.toDate();
      return Number.isFinite(d?.getTime?.()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeUsage(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  return {
    dayKey: typeof base.dayKey === "string" ? base.dayKey : todayUtcKey(),
    usage: {
      conversation_ms: Math.max(0, Number(base?.usage?.conversation_ms || 0)),
      megaphone_ms: Math.max(0, Number(base?.usage?.megaphone_ms || 0)),
      camera_scans: Math.max(0, Number(base?.usage?.camera_scans || 0)),
      text_translate_requests: Math.max(0, Number(base?.usage?.text_translate_requests || 0)),
    },
  };
}

function activePaidPlan(data) {
  const ent = data?.entitlements && typeof data.entitlements === "object" ? data.entitlements : null;
  const plan = String(ent?.plan || data?.plan || "free");
  const status = String(ent?.status || data?.planStatus || "").toLowerCase();
  return plan !== "free" && (status === "active" || status === "grace");
}

function readBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function mapStripeStatus(status, cancelAtPeriodEnd = false) {
  if (cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
    return "grace";
  }
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete" || status === "incomplete_expired") {
    return "past_due";
  }
  if (status === "canceled") return "canceled";
  return "inactive";
}

async function upsertUserEntitlements({ uid, plan, status, expiresAt, stripeCustomerId = null, stripeSubscriptionId = null }) {
  const expiresTimestamp = expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null;
  await db.doc(`users/${uid}`).set({
    // Legacy fields (kept for backward compatibility)
    plan,
    planStatus: status,
    planExpiresAt: expiresTimestamp,
    stripeCustomerId,
    stripeSubscriptionId,

    // New server-driven entitlements object
    entitlements: {
      plan,
      status,
      expiresAt: expiresTimestamp,
      provider: "stripe",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Stripe Webhook handler
 * Receives events from Stripe and updates user plans in Firestore
 *
 * Setup:
 * 1. Create products/prices in Stripe Dashboard
 * 2. Add price IDs to PRICE_TO_PLAN above
 * 3. Set secrets: firebase functions:secrets:set STRIPE_SECRET_KEY
 * 4. Set secrets: firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 * 5. Deploy: firebase deploy --only functions
 * 6. Add the function URL as webhook endpoint in Stripe Dashboard
 *    Events to listen: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
 */
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const stripe = new Stripe(stripeSecretKey.value());
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const uid = session.client_reference_id;
          if (!uid) break;

          let plan = "tourist";
          let status = "active";
          let expiresAt = null;
          let subscriptionId = session.subscription || null;

          if (session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            const priceId = subscription.items.data[0]?.price?.id;
            plan = PRICE_TO_PLAN[priceId] || "tourist";
            status = mapStripeStatus(subscription.status, subscription.cancel_at_period_end);
            expiresAt = new Date(subscription.current_period_end * 1000);
          } else {
            // One-time checkout (e.g. tourist weekly pass)
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
            const priceId = lineItems.data[0]?.price?.id;
            plan = PRICE_TO_PLAN[priceId] || "tourist_weekly";
            status = "active";
            if (plan === "tourist_weekly") {
              expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            }
          }

          await upsertUserEntitlements({
            uid,
            plan,
            status,
            expiresAt,
            stripeCustomerId: session.customer || null,
            stripeSubscriptionId: subscriptionId,
          });

          console.log(`User ${uid} subscribed to ${plan}`);
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          // Find user by stripeCustomerId
          const snap = await db.collection("users")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get();

          if (snap.empty) break;

          const userDoc = snap.docs[0];
          const priceId = subscription.items.data[0]?.price?.id;
          const plan = PRICE_TO_PLAN[priceId] || "tourist";
          const status = mapStripeStatus(subscription.status, subscription.cancel_at_period_end);
          const expiresAt = new Date(subscription.current_period_end * 1000);

          await upsertUserEntitlements({
            uid: userDoc.id,
            plan,
            status,
            expiresAt,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
          });

          console.log(`User ${userDoc.id} updated to ${plan}`);
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          const snap = await db.collection("users")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get();

          if (snap.empty) break;

          const userDoc = snap.docs[0];
          await upsertUserEntitlements({
            uid: userDoc.id,
            plan: "free",
            status: "inactive",
            expiresAt: null,
            stripeCustomerId: customerId,
            stripeSubscriptionId: null,
          });

          console.log(`User ${userDoc.id} cancelled — reverted to free`);
          break;
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      res.status(500).send("Internal error");
    }
  }
);

/**
 * Create a Stripe Customer Portal session
 * Called from the app when user clicks "Manage Billing"
 */
exports.createPortalSession = onRequest(
  { secrets: [stripeSecretKey], cors: true, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const { uid } = req.body;
    if (!uid) {
      res.status(400).json({ error: "Missing uid" });
      return;
    }

    const userDoc = await db.doc(`users/${uid}`).get();
    const data = userDoc.data();
    if (!data?.stripeCustomerId) {
      res.status(400).json({ error: "No Stripe customer found" });
      return;
    }

    const stripe = new Stripe(stripeSecretKey.value());
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: data.stripeCustomerId,
      return_url: req.headers.origin || "https://polyglotai-puce.vercel.app",
    });

    res.json({ url: portalSession.url });
  }
);

/**
 * Server-side trial quota consumption.
 * Requires Firebase ID token (supports anonymous users as well).
 */
exports.consumeTrialQuota = onRequest(
  { cors: true, invoker: "public" },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const token = readBearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Missing bearer token" });
        return;
      }
      const decoded = await admin.auth().verifyIdToken(token);
      const uid = decoded?.uid;
      if (!uid) {
        res.status(401).json({ error: "Invalid auth token" });
        return;
      }

      const key = String(req.body?.key || "").trim();
      if (!Object.prototype.hasOwnProperty.call(TRIAL_DAILY_LIMITS, key)) {
        res.status(400).json({ error: "Invalid trial key" });
        return;
      }
      const amount = Math.max(0, Number(req.body?.amount || 0));

      const result = await db.runTransaction(async (tx) => {
        const userRef = db.doc(`users/${uid}`);
        const snap = await tx.get(userRef);
        const data = snap.data() || {};

        if (activePaidPlan(data)) {
          const large = Number.MAX_SAFE_INTEGER;
          return {
            allowed: true,
            remaining: large,
            used: 0,
            limit: large,
            trial: {
              startedAt: null,
              expiresAt: null,
              isActive: false,
              daysRemaining: 0,
            },
          };
        }

        const now = new Date();
        const nowMs = now.getTime();
        const existingTrial = data.trial && typeof data.trial === "object" ? data.trial : {};
        let startedAt = toDateValue(existingTrial.startedAt);
        if (!startedAt) startedAt = now;
        const expiresAt = new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
        const isActive = nowMs < expiresAt.getTime();
        const daysRemaining = isActive
          ? Math.max(1, Math.ceil((expiresAt.getTime() - nowMs) / (24 * 60 * 60 * 1000)))
          : 0;

        const usageState = normalizeUsage(data.trialUsage);
        const todayKey = todayUtcKey(now);
        if (usageState.dayKey !== todayKey) {
          usageState.dayKey = todayKey;
          usageState.usage = {
            conversation_ms: 0,
            megaphone_ms: 0,
            camera_scans: 0,
            text_translate_requests: 0,
          };
        }

        const limit = TRIAL_DAILY_LIMITS[key];
        const used = Number(usageState.usage[key] || 0);

        let allowed = false;
        let nextUsed = used;
        let remaining = 0;

        if (isActive) {
          if (amount === 0) {
            allowed = true;
            remaining = Math.max(0, limit - used);
          } else if (used + amount <= limit) {
            nextUsed = used + amount;
            usageState.usage[key] = nextUsed;
            allowed = true;
            remaining = Math.max(0, limit - nextUsed);
          } else {
            allowed = false;
            remaining = Math.max(0, limit - used);
          }
        } else {
          allowed = false;
          remaining = 0;
        }

        tx.set(userRef, {
          trial: {
            startedAt: admin.firestore.Timestamp.fromDate(startedAt),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            status: isActive ? "active" : "expired",
            durationDays: TRIAL_DURATION_DAYS,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          trialUsage: {
            dayKey: usageState.dayKey,
            usage: usageState.usage,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
          allowed,
          remaining,
          used: nextUsed,
          limit,
          trial: {
            startedAt: startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            isActive,
            daysRemaining,
          },
        };
      });

      res.json(result);
    } catch (err) {
      console.error("consumeTrialQuota error:", err);
      res.status(500).json({ error: "Trial quota failed" });
    }
  },
);

/**
 * Scheduled: revoke expired plans.
 * Runs daily at 02:00 UTC. Finds users whose planExpiresAt has passed
 * (tourist_weekly one-time purchases, or any plan with a past expiry)
 * and resets them to free/inactive.
 */
exports.revokeExpiredPlans = onSchedule(
  { schedule: "every day 02:00", timeZone: "UTC" },
  async () => {
    const now = admin.firestore.Timestamp.now();

    // Query users with an expiry date in the past and still marked as active
    const snap = await db.collection("users")
      .where("entitlements.expiresAt", "<=", now)
      .where("entitlements.status", "in", ["active", "grace"])
      .limit(500)
      .get();

    if (snap.empty) {
      console.log("revokeExpiredPlans: no expired plans found");
      return;
    }

    const batch = db.batch();
    let count = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      // Skip users with an active Stripe subscription — Stripe webhooks handle those
      if (data.stripeSubscriptionId) continue;

      batch.update(doc.ref, {
        plan: "free",
        planStatus: "inactive",
        planExpiresAt: null,
        entitlements: {
          plan: "free",
          status: "inactive",
          expiresAt: null,
          provider: "expired",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }
    console.log(`revokeExpiredPlans: revoked ${count} expired plans`);
  },
);

// ─── Redeem License Key ──────────────────────────────────────────────────────
exports.redeemLicenseKey = onRequest(
  { cors: true, region: "europe-west1" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) return res.status(401).json({ error: "Unauthorized" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing license code" });
    }

    const keyRef = db.collection("license_keys").doc(code.trim().toUpperCase());

    try {
      const result = await db.runTransaction(async (t) => {
        const keyDoc = await t.get(keyRef);
        if (!keyDoc.exists) return { error: "Invalid code", status: 404 };

        const data = keyDoc.data();
        if (!data.active) return { error: "Code is no longer active", status: 410 };

        // Check max uses
        const usedBy = data.usedBy || [];
        if (data.maxUses && usedBy.length >= data.maxUses) {
          return { error: "Code has reached maximum uses", status: 410 };
        }
        // Check if user already used this code
        if (usedBy.includes(uid)) {
          return { error: "You already used this code", status: 409 };
        }

        const plan = data.plan || "pro";
        const durationDays = data.durationDays || null; // null = permanent
        const now = new Date();
        const expiresAt = durationDays
          ? new Date(now.getTime() + durationDays * 86400000)
          : null;

        // Update user entitlements
        const userRef = db.collection("users").doc(uid);
        t.set(
          userRef,
          {
            plan,
            planStatus: "active",
            planExpiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
            entitlements: {
              plan,
              status: "active",
              expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
              provider: "license_key",
              licenseCode: code.trim().toUpperCase(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        // Mark code as used
        t.update(keyRef, {
          usedBy: admin.firestore.FieldValue.arrayUnion(uid),
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { plan, expiresAt: expiresAt ? expiresAt.toISOString() : null };
      });

      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      return res.status(200).json({ success: true, plan: result.plan, expiresAt: result.expiresAt });
    } catch (e) {
      console.error("redeemLicenseKey error:", e);
      return res.status(500).json({ error: "Internal error" });
    }
  },
);

// ─── Create License Key (admin only) ────────────────────────────────────────
const ADMIN_EMAILS = ["polyglot.app2@gmail.com"];

exports.createLicenseKey = onRequest(
  { cors: true, region: "europe-west1" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) return res.status(401).json({ error: "Unauthorized" });

    let email;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      email = decoded.email;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { code, plan, durationDays, maxUses } = req.body || {};
    if (!code || !plan) {
      return res.status(400).json({ error: "Missing code or plan" });
    }

    const docRef = db.collection("license_keys").doc(code.trim().toUpperCase());
    const existing = await docRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: "Code already exists" });
    }

    await docRef.set({
      code: code.trim().toUpperCase(),
      plan,
      durationDays: durationDays || null,
      maxUses: maxUses || null,
      usedBy: [],
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ success: true, code: code.trim().toUpperCase() });
  },
);
