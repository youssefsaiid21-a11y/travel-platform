import crypto from "node:crypto";

// RFC 6238 TOTP over RFC 4648 base32, implemented directly on Node's crypto
// module rather than adding a dependency - the algorithm is short and this
// keeps the trust boundary (nothing but Node's own HMAC-SHA1) obvious.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// 160-bit (20-byte) secret - the standard TOTP key size (matches what
// Google Authenticator/Authy/1Password etc. all expect).
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function generateOtpAuthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`Orbi:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Orbi&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

function hotp(key: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

// Checks the current time step plus one step on either side (±30s) to
// tolerate normal clock drift between the server and the authenticator app -
// standard practice, not a security weakening (still a 90-second window on
// a 6-digit code, same order of magnitude as a single 30s-only check).
export function verifyTotp(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift++) {
    if (hotp(key, counter + drift) === token) return true;
  }
  return false;
}

// Single-use recovery codes for when the authenticator device is
// unavailable - hex rather than base32 so they're visually distinct from
// the enrollment secret and unambiguous to read back.
export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString("hex"));
}
