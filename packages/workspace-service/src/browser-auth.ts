import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
export function hashLaunchNonce(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function hashBrowserCredential(value: string) {
  const salt = randomBytes(16);
  const digest = scryptSync(value, salt, 32);
  return `scrypt:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

export function verifyBrowserCredential(value: string, encoded: string) {
  const [algorithm, saltValue, digestValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !digestValue) return false;
  try {
    const expected = Buffer.from(digestValue, "base64url");
    const actual = scryptSync(value, Buffer.from(saltValue, "base64url"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function parseSessionCookie(header: string | undefined) {
  const cookie = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith("weaver_session="));
  if (!cookie) return null;
  const value = cookie.slice("weaver_session=".length);
  const [id, versionValue, credential, ...extra] = value.split(".");
  const version = Number(versionValue);
  if (!id || !credential || extra.length || !Number.isInteger(version) || version < 1) return null;
  return { id, version, credential };
}
