import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

function secretKey() {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.CLOUD_WORKER_SECRET?.trim() ||
    [
      process.env.DHAN_TOTP_SECRET?.trim(),
      process.env.DHAN_CLIENT_ID?.trim(),
    ]
      .filter(Boolean)
      .join(":");
  return scryptSync(secret || "project-one-secret", "project-one-aes", 32);
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(token: string) {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
