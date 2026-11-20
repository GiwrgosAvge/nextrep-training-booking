import type { Database } from "better-sqlite3";
import session, { type SessionData } from "express-session";

interface StoredSession {
  session_data: string;
  expires_at: number;
}

const defaultSessionLifetimeMs = 8 * 60 * 60 * 1000;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Σφάλμα αποθήκευσης συνεδρίας.");
}

export class SqliteSessionStore extends session.Store {
  constructor(private readonly database: Database) {
    super();
    this.database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
  }

  get(
    sessionId: string,
    callback: (error: unknown, data?: SessionData | null) => void,
  ): void {
    try {
      const stored = this.database
        .prepare("SELECT session_data, expires_at FROM sessions WHERE sid = ?")
        .get(sessionId) as StoredSession | undefined;
      if (!stored || stored.expires_at <= Date.now()) {
        this.database.prepare("DELETE FROM sessions WHERE sid = ?").run(sessionId);
        callback(null, null);
        return;
      }

      callback(null, JSON.parse(stored.session_data) as SessionData);
    } catch (error) {
      callback(toError(error));
    }
  }

  set(
    sessionId: string,
    data: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    try {
      const expiresAt = data.cookie.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + (data.cookie.maxAge ?? defaultSessionLifetimeMs);
      this.database
        .prepare(
          `INSERT INTO sessions (sid, session_data, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             session_data = excluded.session_data,
             expires_at = excluded.expires_at`,
        )
        .run(sessionId, JSON.stringify(data), expiresAt);
      callback?.(null);
    } catch (error) {
      callback?.(toError(error));
    }
  }

  destroy(sessionId: string, callback?: (error?: unknown) => void): void {
    try {
      this.database.prepare("DELETE FROM sessions WHERE sid = ?").run(sessionId);
      callback?.(null);
    } catch (error) {
      callback?.(toError(error));
    }
  }

  touch(sessionId: string, data: SessionData, callback?: () => void): void {
    try {
      const expiresAt = data.cookie.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + (data.cookie.maxAge ?? defaultSessionLifetimeMs);
      this.database
        .prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?")
        .run(expiresAt, sessionId);
      callback?.();
    } catch (error) {
      this.emit("disconnect", toError(error));
    }
  }
}
