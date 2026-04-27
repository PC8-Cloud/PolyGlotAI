import {
  GoogleAuthProvider,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "../firebase";

const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/popup-closed-by-browser",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
]);

/**
 * Sign in with Google. Tries a popup first; on environments where popups are
 * blocked or unsupported (some mobile browsers, embedded webviews) it falls
 * back to a full-page redirect.
 *
 * Returns the User on popup success. With a redirect fallback the page
 * navigates away and the promise never resolves.
 */
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code && POPUP_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, provider);
      return await new Promise<User>(() => {});
    }
    throw err;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signInGuest(): Promise<User> {
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/**
 * Make sure there is a signed-in user and return their uid.
 *
 * Default strategy is anonymous (used by metrics and guest room joins so
 * activity can happen without a real account). If anonymous auth is not
 * enabled in the Firebase project, we fall back to Google so the operation
 * still succeeds.
 *
 * Pass `{ provider: "google" }` to require a Google account up front
 * (used by host-only flows that need a stable identity).
 */
export async function ensureSignedIn(
  opts?: { provider?: "anonymous" | "google" },
): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  const provider = opts?.provider ?? "anonymous";
  if (provider === "google") {
    const user = await signInWithGoogle();
    return user.uid;
  }
  try {
    const user = await signInGuest();
    return user.uid;
  } catch {
    const user = await signInWithGoogle();
    return user.uid;
  }
}

export async function signOutCurrent(): Promise<void> {
  await signOut(auth);
}
