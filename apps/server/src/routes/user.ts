import { Hono, type Context, type Next } from 'hono';
import { db, type GuestSettings, type User, isValidSettings } from '../db';
import { verifyToken, extractToken } from '../auth/jwt';

type Variables = {
  user: User;
  userId: string;
};

const user = new Hono<{ Variables: Variables }>();

// DB availability check middleware
user.use('*', async (c, next) => {
  if (!db.isAvailable) {
    return c.json({ error: 'Database unavailable. Start MongoDB to enable auth.' }, 503);
  }
  await next();
});

async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  const token = extractToken(c.req.header('Authorization') ?? null);

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const userData = await db.findUserById(payload.userId);
  if (!userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Store user in request context
  c.set('user', userData);
  c.set('userId', payload.userId);

  await next();
}

user.get('/settings', authMiddleware, async (c) => {
  const userId = c.get('userId');

  try {
    const settings = await db.getUserSettings(userId);

    if (!settings) {
      // Return defaults if no saved settings
      return c.json({
        instruments: [],
        autoScrollEnabled: true,
      });
    }

    return c.json(settings);
  } catch (error) {
    console.error('[User API] Failed to get settings:', error);
    return c.json({ error: 'Failed to get settings' }, 500);
  }
});

user.put('/settings', authMiddleware, async (c) => {
  const userId = c.get('userId');

  let body: GuestSettings;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!isValidSettings(body)) {
    return c.json({ error: 'Invalid settings format' }, 400);
  }

  try {
    await db.saveUserSettings(userId, body);
    return c.json({ success: true });
  } catch (error) {
    console.error('[User API] Failed to save settings:', error);
    return c.json({ error: 'Failed to save settings' }, 500);
  }
});

export default user;
