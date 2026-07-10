import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// AES-256-GCM encryption for AI provider API keys stored in SQLite. The key is
// derived from APP_ENCRYPTION_KEY; in development a fixed dev secret is used so
// the app works out of the box. Set APP_ENCRYPTION_KEY in production.
const ALGORITHM = "aes-256-gcm";
const KEY_SALT = "debate-ai-config-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.APP_ENCRYPTION_KEY;
  if (secret && secret.length >= 16) {
    cachedKey = scryptSync(secret, KEY_SALT, 32);
    return cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_ENCRYPTION_KEY must be set (>=16 chars) in production to encrypt AI keys.");
  }

  // Local-dev fallback so the feature works without extra setup.
  cachedKey = scryptSync("debate-local-dev-secret", KEY_SALT, 32);
  return cachedKey;
}

/** Encrypts a plaintext secret. Returns "iv:tag:ciphertext" (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Decrypts a payload produced by encryptSecret. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
