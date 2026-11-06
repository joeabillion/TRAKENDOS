import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

/**
 * JWT secret resolution.
 *
 * Priority:
 *  1. process.env.JWT_SECRET, if set and not a known placeholder.
 *  2. Persisted secret at /data/db/jwt.secret.
 *  3. Freshly generated 48 random bytes (hex), written to /data/db/jwt.secret with mode 0600.
 *
 * The resolved secret is cached for the lifetime of the process so sign/verify
 * always agree.
 */

const SECRET_FILE = process.env.JWT_SECRET_FILE || '/data/db/jwt.secret';

const PLACEHOLDER_SECRETS = new Set<string>([
  '',
  'TRAKEND_CHANGE_ME_ON_FIRST_LOGIN',
  'your-secret-key-change-in-production',
  'change-this-secret-in-production',
  'development-secret-key',
]);

let cachedSecret: string | null = null;
let warned = false;

function isUsableEnvSecret(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (PLACEHOLDER_SECRETS.has(trimmed)) return false;
  return trimmed.length >= 16;
}

function readSecretFile(): string | null {
  try {
    const content = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (content.length >= 32 && !PLACEHOLDER_SECRETS.has(content)) {
      return content;
    }
  } catch {
    // missing or unreadable
  }
  return null;
}

function generateAndPersistSecret(): string {
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(SECRET_FILE, secret + '\n', { mode: 0o600 });
    try {
      fs.chmodSync(SECRET_FILE, 0o600);
    } catch {
      /* ignore */
    }
    if (!warned) {
      warned = true;
      console.warn(
        `[auth] JWT_SECRET was not set (or was a placeholder). Generated a new secret and stored it at ${SECRET_FILE}.`
      );
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        `[auth] JWT_SECRET was not set and ${SECRET_FILE} could not be written (${(err as Error).message}). ` +
          'Using an in-memory secret; sessions will not survive a restart.'
      );
    }
  }
  return secret;
}

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.JWT_SECRET;
  if (isUsableEnvSecret(envSecret)) {
    cachedSecret = envSecret.trim();
    return cachedSecret;
  }

  const fileSecret = readSecretFile();
  if (fileSecret) {
    cachedSecret = fileSecret;
    return cachedSecret;
  }

  cachedSecret = generateAndPersistSecret();
  return cachedSecret;
}

export interface JwtPayload {
  id: string;
  username: string;
  role: string;
}

/**
 * Verify a JWT signed with the resolved secret. Returns the payload, or null if
 * the token is missing, malformed, expired, or signed with a different secret.
 */
export function verifyToken(token: string | undefined | null): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || typeof decoded !== 'object') return null;
    const p = decoded as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.username !== 'string') return null;
    return { id: p.id, username: p.username, role: typeof p.role === 'string' ? p.role : 'user' };
  } catch {
    return null;
  }
}
