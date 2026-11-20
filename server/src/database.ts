import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getLocalDay } from "./localDay.js";

interface LegacySlot {
  id: string;
  startsAt: string;
  bookedBy: string | null;
}

const defaultDatabasePath = path.resolve(
  import.meta.dirname,
  "../data/training-booking.sqlite",
);
const defaultLegacySlotsPath = path.resolve(import.meta.dirname, "../data/slots.json");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLegacySlot(value: unknown): value is LegacySlot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const slot = value as Record<string, unknown>;
  return (
    typeof slot.id === "string" &&
    uuidPattern.test(slot.id) &&
    typeof slot.startsAt === "string" &&
    Number.isFinite(Date.parse(slot.startsAt)) &&
    (typeof slot.bookedBy === "string" || slot.bookedBy === null) &&
    (slot.bookedBy === null || slot.bookedBy.trim().length > 0)
  );
}

function importLegacySlots(database: Database.Database, legacySlotsPath: string): void {
  const existingMigration = database
    .prepare("SELECT name FROM schema_migrations WHERE name = ?")
    .get("import-legacy-slots-v1");
  if (existingMigration) {
    return;
  }

  if (!existsSync(legacySlotsPath)) {
    throw new Error(`Δεν βρέθηκε το αρχείο παλιών ωρών: ${legacySlotsPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(legacySlotsPath, "utf8"));
  } catch (error) {
    throw new Error("Δεν ήταν δυνατή η ανάγνωση του αρχείου παλιών ωρών.", {
      cause: error,
    });
  }

  if (!Array.isArray(parsed) || !parsed.every(isLegacySlot)) {
    throw new Error("Το αρχείο παλιών ωρών έχει μη έγκυρη μορφή.");
  }

  const insertSlot = database.prepare(
    "INSERT INTO slots (id, starts_at) VALUES (?, ?)",
  );
  const insertAppointment = database.prepare(
    `INSERT INTO appointments (id, slot_id, legacy_client_name)
     VALUES (?, ?, ?)`,
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (name) VALUES (?)",
  );

  const importTransaction = database.transaction((slots: LegacySlot[]) => {
    for (const slot of slots) {
      insertSlot.run(slot.id, slot.startsAt);
      if (slot.bookedBy !== null) {
        insertAppointment.run(randomUUID(), slot.id, slot.bookedBy);
      }
    }
    recordMigration.run("import-legacy-slots-v1");
  });

  try {
    importTransaction(parsed);
  } catch (error) {
    throw new Error("Δεν ήταν δυνατή η μεταφορά των παλιών ωρών στη SQLite.", {
      cause: error,
    });
  }
}

const localDayMigrationName = "add-appointment-local-day-v1";

// Δεν σβήνουμε και δεν μετακινούμε μόνοι μας ραντεβού: αν τα δεδομένα παραβιάζουν
// τον κανόνα, η μετάβαση σταματά (και ακυρώνεται ολόκληρη) με λίστα των προβλημάτων.
function addAppointmentLocalDay(database: Database.Database): void {
  const alreadyApplied = database
    .prepare("SELECT name FROM schema_migrations WHERE name = ?")
    .get(localDayMigrationName);
  if (alreadyApplied) {
    return;
  }

  const migrate = database.transaction(() => {
    const columns = database.prepare("PRAGMA table_info(appointments)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "local_day")) {
      database.exec("ALTER TABLE appointments ADD COLUMN local_day TEXT");
    }

    const rows = database
      .prepare(
        `SELECT a.id, s.starts_at AS startsAt
         FROM appointments a JOIN slots s ON s.id = a.slot_id`,
      )
      .all() as { id: string; startsAt: string }[];
    const setLocalDay = database.prepare("UPDATE appointments SET local_day = ? WHERE id = ?");
    for (const row of rows) {
      setLocalDay.run(getLocalDay(row.startsAt), row.id);
    }

    const duplicates = database
      .prepare(
        `SELECT COALESCE(u.username, a.client_id) AS client, a.local_day AS day,
                COUNT(*) AS total
         FROM appointments a LEFT JOIN users u ON u.id = a.client_id
         WHERE a.client_id IS NOT NULL
         GROUP BY a.client_id, a.local_day
         HAVING COUNT(*) > 1`,
      )
      .all() as { client: string; day: string; total: number }[];
    if (duplicates.length > 0) {
      const list = duplicates
        .map((item) => `${item.client} (${item.day}: ${item.total} ραντεβού)`)
        .join(", ");
      throw new Error(
        `Υπάρχουν ασκούμενοι με πάνω από ένα ραντεβού την ίδια μέρα: ${list}. ` +
          "Ακύρωσε ή μετακίνησε τα επιπλέον ραντεβού και ξεκίνα ξανά τον server.",
      );
    }

    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS appointments_client_day_unique_idx
         ON appointments(client_id, local_day)
         WHERE client_id IS NOT NULL`,
    );
    database
      .prepare("INSERT INTO schema_migrations (name) VALUES (?)")
      .run(localDayMigrationName);
  });
  migrate();
}

export function createDatabase(
  databasePath = defaultDatabasePath,
  legacySlotsPath = defaultLegacySlotsPath,
): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);

  try {
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('trainer', 'client')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        must_change_password INTEGER NOT NULL DEFAULT 0
          CHECK (must_change_password IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        starts_at TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        legacy_client_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
          (client_id IS NOT NULL AND legacy_client_name IS NULL) OR
          (client_id IS NULL AND legacy_client_name IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS appointments_client_id_idx
        ON appointments(client_id);

      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        session_data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
        ON sessions(expires_at);
    `);
    importLegacySlots(database, legacySlotsPath);
    addAppointmentLocalDay(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
