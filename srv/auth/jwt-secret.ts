/**
 * JWT secret loader.
 *
 * Reads `JWT_SECRET` from env. In dev, auto-generates and persists one to
 * `.jwt-secret` on first run so restarts don't invalidate active sessions.
 * Production must set `JWT_SECRET` explicitly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const SECRET_FILE = path.join(process.cwd(), '.jwt-secret');
let cached: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (cached) return cached;

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cached = new TextEncoder().encode(fromEnv);
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var required in production (min 32 chars)');
  }

  // Dev fallback: persist a generated secret across restarts
  if (fs.existsSync(SECRET_FILE)) {
    cached = new TextEncoder().encode(fs.readFileSync(SECRET_FILE, 'utf-8').trim());
    return cached;
  }
  const generated = randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  cached = new TextEncoder().encode(generated);
  return cached;
}
