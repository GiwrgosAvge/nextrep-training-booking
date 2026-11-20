import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import { rateLimit } from "express-rate-limit";
import express, { type Request } from "express";
import { validateNewPassword } from "./passwordPolicy.js";

export type UserRole = "trainer" | "client";

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

interface UserRecord extends AuthUser {
  password_hash: string;
  is_active: number;
  must_change_password: number;
}

declare module "express-session" {
  interface SessionData {
    user?: AuthUser;
  }
}

const usernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;
const loginFailureMessage = "Το όνομα χρήστη ή ο κωδικός δεν είναι σωστά.";
const dummyPasswordHash = bcrypt.hashSync("not-a-valid-account-password", 12);

export async function ensureInitialTrainer(
  database: Database,
  username: string | undefined,
  password: string | undefined,
): Promise<void> {
  const existingTrainer = database
    .prepare("SELECT id FROM users WHERE role = 'trainer' LIMIT 1")
    .get();
  if (existingTrainer) {
    return;
  }

  if (!usernamePattern.test(username ?? "") || !password || password.length < 12) {
    throw new Error(
      "Για τον πρώτο λογαριασμό προπονητή όρισε TRAINER_USERNAME και TRAINER_PASSWORD (τουλάχιστον 12 χαρακτήρες) στο .env.",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database
    .prepare(
      `INSERT INTO users (id, username, password_hash, role)
       VALUES (?, ?, ?, 'trainer')`,
    )
    .run(randomUUID(), username, passwordHash);
}

function getRequestBody(request: Request): {
  username: unknown;
  password: unknown;
} {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null) {
    return { username: undefined, password: undefined };
  }
  const record = body as Record<string, unknown>;
  return { username: record.username, password: record.password };
}

async function saveSession(request: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function regenerateSession(request: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function createAuthRouter(database: Database): express.Router {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: "Πολλές προσπάθειες σύνδεσης. Δοκίμασε ξανά σε ένα λεπτό.",
      });
    },
  });

  router.post("/login", loginLimiter, async (request, response, next) => {
    try {
      const { username, password } = getRequestBody(request);
      const validInput =
        typeof username === "string" &&
        usernamePattern.test(username) &&
        typeof password === "string" &&
        password.length <= 128;
      const user = validInput
        ? (database
            .prepare(
              `SELECT id, username, role, password_hash, is_active,
                      must_change_password
               FROM users WHERE username = ? COLLATE NOCASE`,
            )
            .get(username) as UserRecord | undefined)
        : undefined;
      const passwordMatches = await bcrypt.compare(
        typeof password === "string" ? password : "",
        user?.password_hash ?? dummyPasswordHash,
      );

      if (!validInput || !user || !user.is_active || !passwordMatches) {
        response.status(401).json({ error: loginFailureMessage });
        return;
      }

      await regenerateSession(request);
      request.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      await saveSession(request);
      response.json({
        user: request.session.user,
        mustChangePassword: Boolean(user.must_change_password),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", (request, response) => {
    const user = request.session.user
      ? (database
          .prepare(
            `SELECT id, username, role, is_active, must_change_password
             FROM users WHERE id = ?`,
          )
          .get(request.session.user.id) as
          | (AuthUser & { is_active: number; must_change_password: number })
          | undefined)
      : undefined;
    if (!user || !user.is_active) {
      response.json({ user: null, mustChangePassword: false });
      return;
    }
    response.json({
      user: { id: user.id, username: user.username, role: user.role },
      mustChangePassword: Boolean(user.must_change_password),
    });
  });

  router.post("/change-password", async (request, response, next) => {
    try {
      if (!request.session.user) {
        response.status(401).json({ error: "Χρειάζεται να συνδεθείς για να συνεχίσεις." });
        return;
      }
      const activeUser = database
        .prepare(
          `SELECT username, password_hash FROM users
           WHERE id = ? AND is_active = 1`,
        )
        .get(request.session.user.id) as { username: string; password_hash: string } | undefined;
      if (!activeUser) {
        request.session.destroy(() => undefined);
        response.status(401).json({ error: "Η σύνδεσή σου δεν είναι πλέον ενεργή." });
        return;
      }

      const currentPassword = getRequestBody(request).password;
      const newPassword =
        typeof request.body === "object" &&
        request.body !== null &&
        "newPassword" in request.body
          ? request.body.newPassword
          : undefined;
      if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
        response.status(400).json({ error: "Συμπλήρωσε τον τρέχοντα και τον νέο κωδικό." });
        return;
      }
      if (!(await bcrypt.compare(currentPassword, activeUser.password_hash))) {
        response.status(400).json({ error: "Ο τρέχων κωδικός δεν είναι σωστός." });
        return;
      }
      const passwordError = validateNewPassword(newPassword, {
        username: activeUser.username,
        currentPassword,
      });
      if (passwordError) {
        response.status(400).json({ error: passwordError });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      database
        .prepare(
          `UPDATE users
           SET password_hash = ?, must_change_password = 0
           WHERE id = ?`,
        )
        .run(passwordHash, request.session.user.id);
      response.json({ message: "Ο κωδικός άλλαξε με επιτυχία." });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (request, response, next) => {
    request.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }
      response.clearCookie("training.sid", {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      response.status(204).end();
    });
  });

  return router;
}
