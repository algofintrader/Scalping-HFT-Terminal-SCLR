import { MongoClient, Db, Collection } from 'mongodb';

export interface GuestSettings {
  instruments: Array<{ id: string; symbol: string }>;
  autoScrollEnabled: boolean;
}

export function isValidSettings(obj: unknown): obj is GuestSettings {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  if (!Array.isArray(s.instruments)) return false;
  for (const inst of s.instruments) {
    if (typeof inst !== 'object' || inst === null) return false;
    const i = inst as Record<string, unknown>;
    if (typeof i.id !== 'string' || typeof i.symbol !== 'string') return false;
  }
  return typeof s.autoScrollEnabled === 'boolean';
}

export interface GuestSession {
  _id?: string;
  guestId: string;
  instruments: Array<{ id: string; symbol: string }>;
  autoScrollEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  migratedToUserId: string | null;
}

export interface User {
  _id?: string;
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  google_id: string | null;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
  // Embedded settings
  settings?: {
    instruments: Array<{ id: string; symbol: string }>;
    autoScrollEnabled: boolean;
  };
}

class DatabaseClient {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private _available = false;

  // Collections
  private users: Collection<User> | null = null;
  private guestSessions: Collection<GuestSession> | null = null;

  get isAvailable(): boolean {
    return this._available;
  }

  /**
   * Initialize database connection.
   * Does NOT throw — if MongoDB is unavailable, server continues without auth/settings.
   */
  async initialize(): Promise<void> {
    if (this._available) return;

    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';

    try {
      this.client = new MongoClient(mongoUrl, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await this.client.connect();
      const dbName = process.env.MONGODB_DB || 'sclr';
      this.db = this.client.db(dbName);

      // Get collections
      this.users = this.db.collection<User>('users');
      this.guestSessions = this.db.collection<GuestSession>('guest_sessions');

      // Create indexes
      await this.users.createIndex({ email: 1 }, { unique: true });
      await this.users.createIndex({ id: 1 }, { unique: true });
      await this.users.createIndex({ google_id: 1 }, { sparse: true });
      await this.guestSessions.createIndex({ guestId: 1 }, { unique: true });

      this._available = true;
      console.log(`[DB] MongoDB connected to ${mongoUrl}, database: ${dbName}`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('ECONNREFUSED')) {
        console.warn(`[DB] MongoDB is not running at ${mongoUrl} — auth and settings will be unavailable`);
        console.warn('[DB] To enable auth, start MongoDB:');
        console.warn('     docker run -d --name sclr-mongo -p 27017:27017 mongo:7');
      } else {
        console.warn(`[DB] MongoDB unavailable: ${errMsg} — auth and settings will be unavailable`);
      }
    }
  }

  /**
   * Get guest settings
   */
  async getGuestSettings(guestId: string): Promise<GuestSettings | null> {
    if (!this._available || !this.guestSessions) return null;

    const session = await this.guestSessions.findOne({ guestId });
    if (!session) return null;

    return {
      instruments: session.instruments,
      autoScrollEnabled: session.autoScrollEnabled,
    };
  }

  /**
   * Save guest settings (upsert)
   */
  async saveGuestSettings(guestId: string, settings: GuestSettings): Promise<void> {
    if (!this._available || !this.guestSessions) return;

    const now = new Date();

    await this.guestSessions.updateOne(
      { guestId },
      {
        $set: {
          instruments: settings.instruments,
          autoScrollEnabled: settings.autoScrollEnabled,
          updatedAt: now,
        },
        $setOnInsert: {
          guestId,
          createdAt: now,
          migratedToUserId: null,
        },
      },
      { upsert: true }
    );
  }

  /**
   * Delete guest session
   */
  async deleteGuestSession(guestId: string): Promise<void> {
    if (!this._available || !this.guestSessions) return;
    await this.guestSessions.deleteOne({ guestId });
  }

  /**
   * Mark guest session as migrated
   */
  async markGuestAsMigrated(guestId: string, userId: string): Promise<void> {
    if (!this._available || !this.guestSessions) return;

    await this.guestSessions.updateOne(
      { guestId },
      {
        $set: {
          migratedToUserId: userId,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email: string): Promise<User | null> {
    if (!this._available || !this.users) return null;
    return this.users.findOne({ email });
  }

  /**
   * Find user by ID
   */
  async findUserById(id: string): Promise<User | null> {
    if (!this._available || !this.users) return null;
    return this.users.findOne({ id });
  }

  /**
   * Create user
   */
  async createUser(user: Omit<User, '_id' | 'created_at' | 'updated_at'>): Promise<User | null> {
    if (!this._available || !this.users) return null;

    const now = new Date();
    const newUser: User = {
      ...user,
      created_at: now,
      updated_at: now,
    };

    await this.users.insertOne(newUser);
    return newUser;
  }

  /**
   * Get user settings
   */
  async getUserSettings(userId: string): Promise<GuestSettings | null> {
    if (!this._available || !this.users) return null;

    const user = await this.users.findOne({ id: userId });
    if (!user || !user.settings) return null;

    return {
      instruments: user.settings.instruments,
      autoScrollEnabled: user.settings.autoScrollEnabled,
    };
  }

  /**
   * Save user settings (embedded in user document)
   */
  async saveUserSettings(userId: string, settings: GuestSettings): Promise<void> {
    if (!this._available || !this.users) return;

    await this.users.updateOne(
      { id: userId },
      {
        $set: {
          settings: {
            instruments: settings.instruments,
            autoScrollEnabled: settings.autoScrollEnabled,
          },
          updated_at: new Date(),
        },
      }
    );
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this._available && this.client) {
      await this.client.close();
      console.log('[DB] MongoDB connection closed');
    }
  }
}

// Singleton instance
export const db = new DatabaseClient();
