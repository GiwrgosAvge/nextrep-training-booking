import type { Database } from "better-sqlite3";
import type { RequestHandler } from "express";
import type { UserRole } from "./auth.js";

export function requireAuthenticated(database: Database): RequestHandler {
  return (request, response, next) => {
    if (!request.session.user) {
      response.status(401).json({ error: "Χρειάζεται να συνδεθείς για να συνεχίσεις." });
      return;
    }
    const activeUser = database
      .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
      .get(request.session.user.id);
    if (!activeUser) {
      request.session.destroy(() => undefined);
      response.status(401).json({ error: "Η σύνδεσή σου δεν είναι πλέον ενεργή." });
      return;
    }
    next();
  };
}

export function requireRole(database: Database, ...roles: UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.session.user) {
      requireAuthenticated(database)(request, response, next);
      return;
    }
    const user = database
      .prepare(
        `SELECT role, must_change_password
         FROM users WHERE id = ? AND is_active = 1`,
      )
      .get(request.session.user.id) as
      | { role: UserRole; must_change_password: number }
      | undefined;
    if (!user) {
      request.session.destroy(() => undefined);
      response.status(401).json({ error: "Η σύνδεσή σου δεν είναι πλέον ενεργή." });
      return;
    }
    if (!roles.includes(user.role)) {
      response.status(403).json({ error: "Δεν έχεις δικαίωμα για αυτή την ενέργεια." });
      return;
    }
    if (user.must_change_password) {
      response.status(403).json({
        error: "Άλλαξε τον προσωρινό κωδικό σου για να συνεχίσεις.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      return;
    }
    next();
  };
}
