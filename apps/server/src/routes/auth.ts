import { Hono } from 'hono';
import { db } from '../db';
import { createToken, verifyToken } from '../auth/jwt';
import { hashPassword, verifyPassword } from '../auth/password';

const auth = new Hono();

// DB availability check middleware
auth.use('*', async (c, next) => {
  if (!db.isAvailable) {
    return c.json({ error: 'Database unavailable. Start MongoDB to enable auth.' }, 503);
  }
  await next();
});

interface RegisterBody {
  email: string;
  password: string;
  guestId?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

auth.post('/register', async (c) => {
  let body: RegisterBody;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { email, password, guestId } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const emailNormalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }

  // Check email is not taken
  const existingUser = await db.findUserByEmail(emailNormalized);
  if (existingUser) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  try {
    const passwordHash = await hashPassword(password);

    const userId = crypto.randomUUID();
    const user = await db.createUser({
      id: userId,
      email: emailNormalized,
      password_hash: passwordHash,
      name: null,
      google_id: null,
      email_verified: false,
    });

    if (!user) {
      return c.json({ error: 'Registration failed' }, 500);
    }

    // Migrate guest settings to the new user account
    if (guestId) {
      const guestSettings = await db.getGuestSettings(guestId);
      if (guestSettings) {
        await db.saveUserSettings(userId, guestSettings);
        await db.markGuestAsMigrated(guestId, userId);
        console.log('[Auth] Migrated guest settings:', guestId, '->', userId);
      }
    }

    const token = await createToken({ userId: user.id, email: user.email });

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
      },
      token,
    });
  } catch (error) {
    console.error('[Auth] Registration failed:', error);
    return c.json({ error: 'Registration failed' }, 500);
  }
});

auth.post('/login', async (c) => {
  let body: LoginBody;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const emailNormalized = email.trim().toLowerCase();

  const user = await db.findUserByEmail(emailNormalized);
  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = await createToken({ userId: user.id, email: user.email });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
    },
    token,
  });
});

auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token);

    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await db.findUserById(payload.userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
    });
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export default auth;
