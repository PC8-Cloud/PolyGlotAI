import type { VercelRequest, VercelResponse } from "@vercel/node";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "polyglot-c1941";
const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  "AIzaSyAGlijaZaOD94fFfv4I8mlTIFdJQeeAYPI";

type Plan = "free" | "tourist_weekly" | "tourist" | "pro" | "business";
type Feature = "conversation" | "camera" | "megaphone" | "room" | "phrases" | "converter" | "voiceClone";
type TrialQuotaKey = "conversation_ms" | "megaphone_ms" | "camera_scans" | "text_translate_requests";

interface AccessOptions {
  feature?: Feature;
  quotaKey?: TrialQuotaKey;
  quotaAmount?: number;
  paidOnly?: boolean;
}

interface FirestoreDoc {
  fields?: Record<string, FirestoreValue>;
}

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

const PLAN_FEATURES: Record<Plan, Record<Feature, boolean>> = {
  free: {
    conversation: true,
    camera: false,
    megaphone: false,
    room: false,
    phrases: true,
    converter: true,
    voiceClone: false,
  },
  tourist_weekly: {
    conversation: true,
    camera: true,
    megaphone: true,
    room: false,
    phrases: true,
    converter: true,
    voiceClone: false,
  },
  tourist: {
    conversation: true,
    camera: true,
    megaphone: true,
    room: false,
    phrases: true,
    converter: true,
    voiceClone: false,
  },
  pro: {
    conversation: true,
    camera: true,
    megaphone: true,
    room: true,
    phrases: true,
    converter: true,
    voiceClone: true,
  },
  business: {
    conversation: true,
    camera: true,
    megaphone: true,
    room: true,
    phrases: true,
    converter: true,
    voiceClone: true,
  },
};

const TRIAL_FEATURES: Record<Feature, boolean> = {
  conversation: true,
  camera: true,
  megaphone: true,
  room: false,
  phrases: true,
  converter: true,
  voiceClone: false,
};

function readBearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization || "";
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function stringField(value: FirestoreValue | undefined): string | null {
  if (!value) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.timestampValue === "string") return value.timestampValue;
  return null;
}

function mapFields(value: FirestoreValue | undefined): Record<string, FirestoreValue> {
  return value?.mapValue?.fields || {};
}

function normalizePlan(raw: string | null): Plan {
  const value = String(raw || "free").toLowerCase();
  return value === "tourist_weekly" || value === "tourist" || value === "pro" || value === "business"
    ? value
    : "free";
}

function isFuture(raw: string | null): boolean {
  if (!raw) return false;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > Date.now();
}

async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  const data = await res.json().catch(() => ({}));
  const user = Array.isArray(data?.users) ? data.users[0] : null;
  if (!res.ok || !user?.localId) {
    throw new Error("Invalid Firebase token");
  }
  return { uid: String(user.localId), email: typeof user.email === "string" ? user.email : undefined };
}

async function fetchUserDoc(uid: string, idToken: string): Promise<FirestoreDoc | null> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`User entitlements unavailable (${res.status})`);
  return res.json();
}

function readAccess(doc: FirestoreDoc | null): { plan: Plan; paidActive: boolean; trialActive: boolean } {
  const fields = doc?.fields || {};
  const ent = mapFields(fields.entitlements);
  const plan = normalizePlan(stringField(ent.plan) || stringField(fields.plan));
  const status = String(stringField(ent.status) || stringField(fields.planStatus) || "").toLowerCase();
  const expiresAt = stringField(ent.expiresAt) || stringField(fields.planExpiresAt);
  const paidActive =
    plan !== "free" &&
    (((status === "active" || status === "grace") && (!expiresAt || isFuture(expiresAt))) ||
      (!status && isFuture(expiresAt)));

  const trial = mapFields(fields.trial);
  const trialActive = isFuture(stringField(trial.expiresAt));

  return { plan: paidActive ? plan : "free", paidActive, trialActive };
}

async function consumeTrialQuota(idToken: string, key: TrialQuotaKey, amount: number): Promise<boolean> {
  const res = await fetch(
    `https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/consumeTrialQuota`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ key, amount: Math.max(0, Number(amount) || 0) }),
    },
  );
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data?.allowed === true;
}

export async function requireApiAccess(
  req: VercelRequest,
  res: VercelResponse,
  options: AccessOptions = {},
): Promise<{ uid: string; email?: string } | null> {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required", status: 401 });
    return null;
  }

  try {
    const user = await verifyFirebaseToken(token);
    const doc = await fetchUserDoc(user.uid, token);
    const access = readAccess(doc);
    const feature = options.feature || "conversation";

    if (options.paidOnly && !access.paidActive) {
      res.status(402).json({ error: "Paid plan required", status: 402 });
      return null;
    }

    let quotaAllowed = false;
    if (!access.paidActive && options.quotaKey) {
      quotaAllowed = await consumeTrialQuota(token, options.quotaKey, options.quotaAmount ?? 1);
      if (!quotaAllowed) {
        res.status(402).json({ error: "Trial quota exceeded", status: 402 });
        return null;
      }
    }

    const featureAllowed = access.paidActive
      ? PLAN_FEATURES[access.plan][feature]
      : PLAN_FEATURES.free[feature] ||
        ((access.trialActive || quotaAllowed) && TRIAL_FEATURES[feature]);

    if (!featureAllowed) {
      res.status(402).json({ error: "Upgrade required", status: 402 });
      return null;
    }

    return user;
  } catch (err: any) {
    res.status(401).json({ error: err?.message || "Authentication failed", status: 401 });
    return null;
  }
}
