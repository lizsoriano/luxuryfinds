import crypto from "node:crypto";

// AES-256-GCM for the two `bytea` columns on refund_requests (clabe_encrypted,
// account_reference_encrypted) that hold real bank account data. Needs
// REFUND_ENCRYPTION_KEY in the environment: a 64-character hex string (32
// random bytes), e.g. generated with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
// Never reuse SUPABASE_SECRET_KEY or any other existing secret for this.

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.REFUND_ENCRYPTION_KEY;
  if (!secret) throw new Error("Falta configurar REFUND_ENCRYPTION_KEY para poder cifrar datos bancarios.");
  const key = Buffer.from(secret, "hex");
  if (key.length !== 32) {
    throw new Error("REFUND_ENCRYPTION_KEY debe ser una cadena hexadecimal de 64 caracteres (32 bytes).");
  }
  return key;
}

/**
 * Encrypts to the `\x`-prefixed hex text PostgREST expects for a `bytea`
 * column (Postgres's default `bytea_output` is `hex`, and PostgREST both
 * sends and accepts that format as plain JSON strings for bytea columns).
 * Layout: 12-byte IV + 16-byte GCM auth tag + ciphertext.
 */
export function encryptToBytea(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `\\x${Buffer.concat([iv, authTag, encrypted]).toString("hex")}`;
}

/** Reverses encryptToBytea. `stored` is whatever PostgREST returned for the bytea column. */
export function decryptFromBytea(stored: string): string {
  const hex = stored.startsWith("\\x") ? stored.slice(2) : stored;
  const payload = Buffer.from(hex, "hex");
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Shows only the last 4 characters — for list views where the full CLABE isn't needed yet. */
export function maskAccountNumber(value: string): string {
  if (value.length <= 4) return value;
  return `••••${value.slice(-4)}`;
}
