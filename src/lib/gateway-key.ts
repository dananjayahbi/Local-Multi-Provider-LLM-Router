import crypto from "crypto";
import bcrypt from "bcryptjs";

const KEY_LENGTH = 48; // characters in the generated key
const PREFIX_LENGTH = 4; // characters to show in the GUI

export function generateGatewayKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = "sk-" + crypto.randomBytes(KEY_LENGTH).toString("base64url").slice(0, KEY_LENGTH);
  const hash = bcrypt.hashSync(plaintext, 10);
  const prefix = plaintext.slice(0, 3) + "..." + plaintext.slice(-PREFIX_LENGTH);
  return { plaintext, hash, prefix };
}

export function verifyGatewayKey(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}

export function maskApiKey(secret: string, showFull: boolean = false): string {
  if (showFull) return secret;
  if (secret.length <= 8) return "****";
  return secret.slice(0, 3) + "..." + secret.slice(-4);
}
