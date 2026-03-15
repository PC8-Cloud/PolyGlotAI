import { db, auth } from "../firebase";
import { signInAnonymously, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";

// Ensure user is authenticated: try anonymous, fall back to Google
async function ensureAuth(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch {
    // Anonymous auth not enabled — fall back to Google
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    return cred.user.uid;
  }
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function createSession(
  title: string,
  sourceLanguage: string,
  targetLanguages: string[],
) {
  if (!auth.currentUser)
    throw new Error("Must be logged in to create a session");

  const sessionId = doc(collection(db, "sessions")).id;
  const path = `sessions/${sessionId}`;

  try {
    await setDoc(doc(db, "sessions", sessionId), {
      hostId: auth.currentUser.uid,
      title,
      sourceLanguage,
      targetLanguages,
      status: "ACTIVE",
      createdAt: serverTimestamp(),
    });
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function joinSession(
  sessionId: string,
  language: string,
  displayName: string,
  role: "HOST" | "GUEST" = "GUEST",
) {
  // We use a random ID for guests if they are not logged in
  const participantId =
    auth.currentUser?.uid || doc(collection(db, "dummy")).id;
  const path = `sessions/${sessionId}/participants/${participantId}`;

  try {
    await setDoc(
      doc(db, "sessions", sessionId, "participants", participantId),
      {
        sessionId,
        role,
        language,
        displayName,
        joinedAt: serverTimestamp(),
      },
    );
    return participantId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// ─── Room-based sessions (with numeric code) ────────────────────────────────

function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createRoom(hostLang: string) {
  const hostId = await ensureAuth();
  const roomCode = generateRoomCode();
  const sessionId = doc(collection(db, "sessions")).id;

  // Must match isValidSession rule: hostId, title, sourceLanguage, targetLanguages, status, createdAt
  await setDoc(doc(db, "sessions", sessionId), {
    hostId,
    title: "Room " + roomCode,
    sourceLanguage: hostLang,
    targetLanguages: [],
    status: "ACTIVE",
    createdAt: serverTimestamp(),
    roomCode,
  });

  return { sessionId, roomCode, hostId };
}

export async function findRoomByCode(code: string): Promise<string | null> {
  const q = query(
    collection(db, "sessions"),
    where("roomCode", "==", code),
    where("status", "==", "ACTIVE"),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function joinRoom(sessionId: string, language: string, displayName: string) {
  await ensureAuth();
  // Use a unique ID per join (not auth UID) so multiple tabs/devices work independently
  const participantId = doc(collection(db, "sessions", sessionId, "participants")).id;

  await setDoc(
    doc(db, "sessions", sessionId, "participants", participantId),
    {
      sessionId,
      role: "GUEST",
      language,
      displayName,
      joinedAt: serverTimestamp(),
    },
  );

  return participantId;
}

export async function sendMessage(
  sessionId: string,
  senderId: string,
  type: "BROADCAST" | "QUESTION" | "ANSWER" | "CONCIERGE",
  sourceLanguage: string,
  sourceText: string,
  translations: Record<string, string>,
  senderName?: string,
) {
  const messageId = doc(collection(db, `sessions/${sessionId}/messages`)).id;
  const path = `sessions/${sessionId}/messages/${messageId}`;

  try {
    await setDoc(doc(db, "sessions", sessionId, "messages", messageId), {
      sessionId,
      senderId,
      type,
      sourceLanguage,
      sourceText,
      translations,
      createdAt: serverTimestamp(),
      ...(senderName ? { senderName } : {}),
    });
    return messageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
