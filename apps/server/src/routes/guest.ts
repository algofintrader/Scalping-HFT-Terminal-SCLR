import { Hono } from 'hono';
import { db, type GuestSettings, isValidSettings } from '../db';

const guest = new Hono();

guest.get('/:guestId/settings', async (c) => {
  const guestId = c.req.param('guestId');

  if (!isValidUUID(guestId)) {
    return c.json({ error: 'Invalid guest ID format' }, 400);
  }

  try {
    const settings = await db.getGuestSettings(guestId);

    if (!settings) {
      // Return default settings for new guest
      return c.json({
        instruments: [],
        autoScrollEnabled: true,
      });
    }

    return c.json(settings);
  } catch (error) {
    console.error('[Guest API] Failed to get settings:', error);
    return c.json({ error: 'Failed to get settings' }, 500);
  }
});

guest.put('/:guestId/settings', async (c) => {
  const guestId = c.req.param('guestId');

  if (!isValidUUID(guestId)) {
    return c.json({ error: 'Invalid guest ID format' }, 400);
  }

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
    await db.saveGuestSettings(guestId, body);
    return c.json({ success: true });
  } catch (error) {
    console.error('[Guest API] Failed to save settings:', error);
    return c.json({ error: 'Failed to save settings' }, 500);
  }
});

guest.delete('/:guestId', async (c) => {
  const guestId = c.req.param('guestId');

  if (!isValidUUID(guestId)) {
    return c.json({ error: 'Invalid guest ID format' }, 400);
  }

  try {
    await db.deleteGuestSession(guestId);
    return c.json({ success: true });
  } catch (error) {
    console.error('[Guest API] Failed to delete session:', error);
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export default guest;
