import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { DEFAULT_CONFIG } from '../config/default';

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
    DEFAULT_CONFIG.JWT.SECRET,
    options
  );
}

export function verifyToken(token: string): { id: string; username: string; role: string } | null {
  try {
    const decoded = jwt.verify(token, DEFAULT_CONFIG.JWT.SECRET) as {
      id: string;
      username: string;
      role: string;
    };
    return decoded;
  } catch {
    return null;
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.split(' ')[1];

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
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}
