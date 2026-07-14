import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";

// These tests describe the SECURE behaviour we want from firestore.rules.
// Against the current (permissive) rules some of them are expected to FAIL —
// that is the point: they define the target before the fix. After tightening
// the rules they must all pass, including the regression guards that keep the
// legitimate host/guest flows working.
//
// Run with: npm run test:rules  (boots the Firestore emulator; needs Java).

const PROJECT_ID = "polyglot-rules-test";
const HOST = "host_uid";
const GUEST = "guest_uid";
const OTHER = "other_uid";
const STRANGER = "stranger_uid";
const SESSION_ID = "S1";

let testEnv: RulesTestEnvironment;

const now = () => Timestamp.now();

function validSession(hostId: string) {
  return {
    hostId,
    title: "Room di test",
    sourceLanguage: "it",
    targetLanguages: ["en", "fr"],
    status: "ACTIVE",
    createdAt: now(),
  };
}

function validParticipant(userId: string, role: "HOST" | "GUEST" = "GUEST") {
  return {
    sessionId: SESSION_ID,
    role,
    language: "en",
    joinedAt: now(),
    userId,
  };
}

function validMessage(senderId: string) {
  return {
    sessionId: SESSION_ID,
    senderId,
    type: "BROADCAST",
    sourceLanguage: "it",
    sourceText: "Ciao a tutti",
    createdAt: now(),
  };
}

// Seed baseline data bypassing the rules: a session hosted by HOST and a
// participant document for GUEST (whose doc id equals the uid, as the rules'
// isParticipantOwner() expects).
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "sessions", SESSION_ID), validSession(HOST));
    await setDoc(
      doc(db, "sessions", SESSION_ID, "participants", GUEST),
      validParticipant(GUEST),
    );
    await setDoc(
      doc(db, "sessions", SESSION_ID, "participants", OTHER),
      validParticipant(OTHER),
    );
    await setDoc(
      doc(db, "sessions", SESSION_ID, "messages", "seedMsg"),
      validMessage(HOST),
    );
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

describe("app_usage_daily — telemetry must require authentication", () => {
  const validDoc = { dayKey: "2026-07-14", deviceId: "device-abc" };

  it("DENIES an unauthenticated write (security fix)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "app_usage_daily", "2026-07-14_device-abc"), validDoc),
    );
  });

  it("ALLOWS an authenticated write with valid shape (keeps telemetry working)", async () => {
    const db = testEnv.authenticatedContext(GUEST).firestore();
    await assertSucceeds(
      setDoc(doc(db, "app_usage_daily", "2026-07-14_device-abc"), validDoc),
    );
  });
});

describe("messages — only host or a registered participant may write", () => {
  it("DENIES a message from a non-participant, even with senderId=self (security fix)", async () => {
    const db = testEnv.authenticatedContext(STRANGER).firestore();
    await assertFails(
      setDoc(
        doc(db, "sessions", SESSION_ID, "messages", "m_stranger"),
        validMessage(STRANGER),
      ),
    );
  });

  it("ALLOWS the host to write a message (regression guard)", async () => {
    const db = testEnv.authenticatedContext(HOST).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "sessions", SESSION_ID, "messages", "m_host"),
        validMessage(HOST),
      ),
    );
  });

  it("ALLOWS a registered participant to write a message (regression guard)", async () => {
    const db = testEnv.authenticatedContext(GUEST).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "sessions", SESSION_ID, "messages", "m_guest"),
        validMessage(GUEST),
      ),
    );
  });

  it("DENIES posting as a participant the caller does not own (anti-spoof)", async () => {
    // GUEST tries to post with senderId = OTHER, a participant owned by someone
    // else. isParticipantOwner checks the doc's userId == caller, so this fails.
    const db = testEnv.authenticatedContext(GUEST).firestore();
    await assertFails(
      setDoc(
        doc(db, "sessions", SESSION_ID, "messages", "m_spoof"),
        validMessage(OTHER),
      ),
    );
  });
});

describe("messages — only host or a registered participant may read", () => {
  it("DENIES reading the message stream to a non-participant (security fix)", async () => {
    const db = testEnv.authenticatedContext(STRANGER).firestore();
    await assertFails(
      getDocs(collection(db, "sessions", SESSION_ID, "messages")),
    );
  });

  it("ALLOWS a registered participant to read the message stream (regression guard)", async () => {
    const db = testEnv.authenticatedContext(GUEST).firestore();
    await assertSucceeds(
      getDocs(collection(db, "sessions", SESSION_ID, "messages")),
    );
  });

  it("ALLOWS the host to read the message stream (regression guard)", async () => {
    const db = testEnv.authenticatedContext(HOST).firestore();
    await assertSucceeds(
      getDocs(collection(db, "sessions", SESSION_ID, "messages")),
    );
  });
});

describe("sessions — creation is bound to the host identity (regression guard)", () => {
  it("ALLOWS a host to create their own session", async () => {
    const db = testEnv.authenticatedContext(HOST).firestore();
    await assertSucceeds(
      setDoc(doc(db, "sessions", "S_new"), validSession(HOST)),
    );
  });

  it("DENIES creating a session with someone else's hostId", async () => {
    const db = testEnv.authenticatedContext(STRANGER).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", "S_forged"), validSession(HOST)),
    );
  });

  it("ALLOWS any authenticated user to read a session (needed to join via link/code)", async () => {
    const db = testEnv.authenticatedContext(STRANGER).firestore();
    await assertSucceeds(getDoc(doc(db, "sessions", SESSION_ID)));
  });

  it("DENIES reading a session to an unauthenticated client (security fix)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "sessions", SESSION_ID)));
  });
});

describe("participants — only host or a member may read the list", () => {
  it("DENIES an unauthenticated client (security fix)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDocs(collection(db, "sessions", SESSION_ID, "participants")),
    );
  });

  it("DENIES a non-member (security fix)", async () => {
    const db = testEnv.authenticatedContext(STRANGER).firestore();
    await assertFails(
      getDocs(collection(db, "sessions", SESSION_ID, "participants")),
    );
  });

  it("ALLOWS a registered participant (regression guard)", async () => {
    const db = testEnv.authenticatedContext(GUEST).firestore();
    await assertSucceeds(
      getDocs(collection(db, "sessions", SESSION_ID, "participants")),
    );
  });

  it("ALLOWS the host (regression guard)", async () => {
    const db = testEnv.authenticatedContext(HOST).firestore();
    await assertSucceeds(
      getDocs(collection(db, "sessions", SESSION_ID, "participants")),
    );
  });
});
