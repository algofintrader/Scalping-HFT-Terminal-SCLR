import { sign, verify } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || '';

if (!JWT_SECRET) {
  console.warn('[JWT] JWT_SECRET is not set — auth endpoints will not work');
  console.warn('[JWT] Generate one with: openssl rand -hex 32');
}

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/** Create a JWT token (7-day expiry) */
export async function createToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string | null> {
  if (!JWT_SECRET) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 24 * 60 * 60; // 7 days

  return await sign(
    {
      ...payload,
      iat: now,
      exp,
    },
    JWT_SECRET,
    'HS256'
  );
}

/** Verify and decode a JWT token */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  if (!JWT_SECRET) return null;

  try {
    const decoded = await verify(token, JWT_SECRET, 'HS256');
    // Validate required fields in payload
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded && 'email' in decoded) {
      return decoded as unknown as JWTPayload;
    }
    return null;
  } catch (error) {
    console.warn('[JWT] Invalid token:', error);
    return null;
  }
}

/** Extract token from Authorization header */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
