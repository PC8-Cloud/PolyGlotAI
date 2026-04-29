import { cloudFunctionUrl } from "../firebase";

function parseCsv(raw: unknown): string[] {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .map((value) => value.toLowerCase())
    .filter(Boolean);
}

export const ADMIN_EMAILS = parseCsv(
  (import.meta as any).env?.VITE_ADMIN_EMAILS || "polyglot.app2@gmail.com",
);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export const CREATE_LICENSE_KEY_URL =
  String((import.meta as any).env?.VITE_CREATE_LICENSE_KEY_URL || "").trim() ||
  cloudFunctionUrl("createLicenseKey", "europe-west1");

export const REDEEM_LICENSE_KEY_URL =
  String((import.meta as any).env?.VITE_REDEEM_LICENSE_KEY_URL || "").trim() ||
  cloudFunctionUrl("redeemLicenseKey", "europe-west1");
