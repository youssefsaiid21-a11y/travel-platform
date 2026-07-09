import crypto from "node:crypto";

// AES-256-GCM field-level encryption for the single most sensitive column
// in the app - PassengerProfile.passportNumber. Nationality/expiry are a
// country code and a date; on their own they aren't meaningfully sensitive
// without the document number itself, so encrypting just this field is the
// correctly-scoped fix rather than encrypting everything for its own sake.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // standard/recommended IV size for GCM

function getKey(): Buffer {
  const key = process.env.PASSPORT_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("PASSPORT_ENCRYPTION_KEY is not set.");
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "PASSPORT_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256)."
    );
  }
  return buf;
}

// Encoded as base64(iv).base64(authTag).base64(ciphertext) - all three are
// required to decrypt, and GCM's auth tag means a tampered ciphertext (DB
// row edited directly, corruption) fails loudly instead of decrypting to
// garbage silently.
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptField(encoded: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted field.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

const ENCRYPTED_FIELD_RE = /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/;

// Rows written before this field existed store a plain passport number -
// passed through as-is rather than crashing, since there's no migration
// step that could have retroactively encrypted them. Every new write goes
// through encryptField() above, so this fallback only ever applies to
// pre-existing data.
export function safeDecryptPassport(value: string | null): string | null {
  if (!value) return value;
  if (!ENCRYPTED_FIELD_RE.test(value)) return value;
  try {
    return decryptField(value);
  } catch {
    return value;
  }
}
