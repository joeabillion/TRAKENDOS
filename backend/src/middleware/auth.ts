import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { DEFAULT_CONFIG } from '../config/default';
import { getJwtSecret, verifyToken as verifyJwt } from '../utils/secret';

export { getJwtSecret };

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export function createToken(userId: string, username: string, role: string = 'user'): string {
  const options: jwt.SignOptions = { expiresIn: DEFAULT_CONFIG.JWT.EXPIRY as any };
  return jwt.sign(
    { id: userId, username, role },
    getJwtSecret(),
    options
  );
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired.
 * Also used by the WebSocket upgrade handler in index.ts.
 */
export function verifyToken(token: string): { id: string; username: string; role: string } | null {
  return verifyJwt(token);
}

/** Bearer header first; `?token=` only for browser-navigated downloads/exports (no header possible). */
function extractToken(req: AuthRequest): string | undefined {
  const header = req.headers.authorization?.split(' ')[1];
  if (header) return header;
  const q = req.query?.token;
  if (typeof q === 'string' && q && req.method === 'GET') return q;
  return undefined;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.user = decoded;
  next();
}

export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}
