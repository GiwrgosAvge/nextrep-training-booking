import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import express, { type Request } from "express";
import { requireRole } from "./authorization.js";
import { createTemporaryPassword } from "./temporaryPassword.js";

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const usernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;

function getClientId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, "Το αναγνωριστικό του ασκούμενου δεν είναι έγκυρο.");
  }
  return value;
}

function getBody(request: Request): Record<string, unknown> {
  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    throw new ApiError(400, "Τα στοιχεία του αιτήματος δεν είναι έγκυρα.");
  }
  return request.body as Record<string, unknown>;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

function revokeUserSessions(database: Database, userId: string): void {
  const sessions = database
    .prepare("SELECT sid, session_data FROM sessions")
    .all() as Array<{ sid: string; session_data: string }>;
  const removeSession = database.prepare("DELETE FROM sessions WHERE sid = ?");

  for (const stored of sessions) {
    const data: unknown = JSON.parse(stored.session_data);
    if (
      typeof data === "object" &&
      data !== null &&
      "user" in data &&
      typeof data.user === "object" &&
      data.user !== null &&
      "id" in data.user &&
      data.user.id === userId
    ) {
      removeSession.run(stored.sid);
    }
  }
}

export function createClientRouter(database: Database): express.Router {
  const router = express.Router();

  router.get("/clients", requireRole(database, "trainer"), (_request, response) => {
    const clients = database
      .prepare(
        `SELECT u.id, u.username, u.is_active AS isActive,
                u.must_change_password AS mustChangePassword,
                u.created_at AS createdAt, COUNT(a.id) AS appointmentCount,
                COALESCE(SUM(CASE WHEN s.starts_at > ? THEN 1 ELSE 0 END), 0)
                  AS upcomingAppointmentCount
         FROM users u
         LEFT JOIN appointments a ON a.client_id = u.id
         LEFT JOIN slots s ON s.id = a.slot_id
         WHERE u.role = 'client'
         GROUP BY u.id
         ORDER BY u.username COLLATE NOCASE`,
      )
      .all(new Date().toISOString());
    response.json({
      clients: clients.map((client) => {
        const record = client as {
          id: string;
          username: string;
          isActive: number;
          mustChangePassword: number;
          createdAt: string;
          appointmentCount: number;
          upcomingAppointmentCount: number;
        };
        return {
          ...record,
          isActive: Boolean(record.isActive),
          mustChangePassword: Boolean(record.mustChangePassword),
        };
      }),
    });
  });

  router.post("/clients", requireRole(database, "trainer"), async (request, response) => {
    const { username } = getBody(request);
    if (typeof username !== "string" || !usernamePattern.test(username)) {
      throw new ApiError(
        400,
        "Το όνομα χρήστη πρέπει να έχει 3–32 χαρακτήρες: λατινικά γράμματα, αριθμούς, τελεία, παύλα ή κάτω παύλα.",
      );
    }

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const id = randomUUID();
    try {
      database
        .prepare(
          `INSERT INTO users
           (id, username, password_hash, role, must_change_password)
           VALUES (?, ?, ?, 'client', 1)`,
        )
        .run(id, username, passwordHash);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(409, "Δεν ήταν δυνατή η δημιουργία λογαριασμού με αυτά τα στοιχεία.");
      }
      throw error;
    }

    response.status(201).json({
      client: { id, username, isActive: true, mustChangePassword: true },
      temporaryPassword,
    });
  });

  router.patch("/clients/:id", requireRole(database, "trainer"), (request, response) => {
    const clientId = getClientId(request.params.id);
    const { isActive } = getBody(request);
    if (typeof isActive !== "boolean") {
      throw new ApiError(400, "Διάλεξε αν ο λογαριασμός θα είναι ενεργός.");
    }

    const result = database
      .prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'client'")
      .run(isActive ? 1 : 0, clientId);
    if (result.changes === 0) {
      throw new ApiError(404, "Ο λογαριασμός ασκούμενου δεν βρέθηκε.");
    }

    if (!isActive) {
      revokeUserSessions(database, clientId);
    }
    response.json({ message: isActive ? "Ο λογαριασμός ενεργοποιήθηκε." : "Ο λογαριασμός απενεργοποιήθηκε." });
  });

  router.post(
    "/clients/:id/reset-password",
    requireRole(database, "trainer"),
    async (request, response) => {
      const clientId = getClientId(request.params.id);
      const temporaryPassword = createTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const result = database
        .prepare(
          `UPDATE users
           SET password_hash = ?, must_change_password = 1
           WHERE id = ? AND role = 'client'`,
        )
        .run(passwordHash, clientId);
      if (result.changes === 0) {
        throw new ApiError(404, "Ο λογαριασμός ασκούμενου δεν βρέθηκε.");
      }

      revokeUserSessions(database, clientId);
      response.json({ temporaryPassword });
    },
  );

  router.delete("/clients/:id", requireRole(database, "trainer"), (request, response) => {
    const clientId = getClientId(request.params.id);
    const removeClient = database.transaction(() => {
      const client = database
        .prepare("SELECT username FROM users WHERE id = ? AND role = 'client'")
        .get(clientId) as { username: string } | undefined;
      if (!client) {
        throw new ApiError(404, "Ο λογαριασμός ασκούμενου δεν βρέθηκε.");
      }

      // Τα μελλοντικά ραντεβού ακυρώνονται (η ώρα ελευθερώνεται), το ιστορικό μένει.
      database
        .prepare(
          `DELETE FROM appointments
           WHERE client_id = ?
             AND slot_id IN (SELECT id FROM slots WHERE starts_at > ?)`,
        )
        .run(clientId, new Date().toISOString());
      database
        .prepare(
          `UPDATE appointments
           SET client_id = NULL, legacy_client_name = ?
           WHERE client_id = ?`,
        )
        .run(client.username, clientId);
      database.prepare("DELETE FROM users WHERE id = ?").run(clientId);
      revokeUserSessions(database, clientId);
    });
    removeClient.immediate();
    response.status(204).end();
  });

  return router;
}

export function handleClientApiError(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}
