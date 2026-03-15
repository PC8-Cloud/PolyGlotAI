const { onRequest } = require("firebase-functions/v2/https");
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
const PRICE_TO_PLAN = {
  // "price_XXXXX": "tourist",
  // "price_YYYYY": "pro",
  // "price_ZZZZZ": "business",
};

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
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
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

          // Get subscription details
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = subscription.items.data[0]?.price?.id;
          const plan = PRICE_TO_PLAN[priceId] || "tourist";
          const expiresAt = new Date(subscription.current_period_end * 1000);

          await db.doc(`users/${uid}`).set({
            plan,
            planExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

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
          const expiresAt = new Date(subscription.current_period_end * 1000);

          await userDoc.ref.update({
            plan,
            planExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
          await userDoc.ref.update({
            plan: "free",
            planExpiresAt: null,
            stripeSubscriptionId: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
  { secrets: [stripeSecretKey], cors: true },
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
