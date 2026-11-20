import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import express, { type Request } from "express";
import { hasStarted } from "./appointmentTime.js";
import { requireRole } from "./authorization.js";
import { getLocalDay, getLocalTime } from "./localDay.js";

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const ALREADY_BOOKED_THAT_DAY = "ALREADY_BOOKED_THAT_DAY";
const APPOINTMENT_IN_PAST = "APPOINTMENT_IN_PAST";

function appointmentInPastError(): ApiError {
  return new ApiError(
    409,
    "Αυτό το ραντεβού έχει ήδη περάσει και δεν μπορεί να αλλάξει ή να ακυρωθεί.",
    APPOINTMENT_IN_PAST,
  );
}
type Perspective = "client" | "trainer";

interface SlotRecord {
  id: string;
  starts_at: string;
}

interface AppointmentRecord {
  id: string;
  slot_id: string;
  client_id: string | null;
}

function getUuid(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, `${label} δεν είναι έγκυρο.`);
  }
  return value;
}

function getStartsAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value ||
    Date.parse(value) <= Date.now()
  ) {
    throw new ApiError(400, "Διάλεξε μια έγκυρη μελλοντική ημερομηνία και ώρα.");
  }
  return value;
}

function getBody(request: Request): Record<string, unknown> {
  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    throw new ApiError(400, "Τα στοιχεία του αιτήματος δεν είναι έγκυρα.");
  }
  return request.body as Record<string, unknown>;
}

function getAppointmentId(request: Request): string {
  return getUuid(request.params.id, "Το αναγνωριστικό του ραντεβού");
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

function insertAppointment(
  database: Database,
  clientId: string,
  slotId: string,
): { id: string; slotId: string; startsAt: string } {
  const insert = database.transaction(() => {
    const slot = database
      .prepare("SELECT id, starts_at FROM slots WHERE id = ? AND starts_at > ?")
      .get(slotId, new Date().toISOString()) as SlotRecord | undefined;
    if (!slot) {
      throw new ApiError(404, "Η διαθέσιμη ώρα δεν βρέθηκε.");
    }

    const localDay = getLocalDay(slot.starts_at);
    assertClientFreeThatDay(database, clientId, localDay, null, "client");

    const existingAppointment = database
      .prepare("SELECT id FROM appointments WHERE slot_id = ?")
      .get(slotId);
    if (existingAppointment) {
      throw new ApiError(409, "Αυτή η ώρα έχει ήδη κλειστεί.");
    }

    const id = randomUUID();
    database
      .prepare(
        "INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)",
      )
      .run(id, slotId, clientId, localDay);
    return { id, slotId: slot.id, startsAt: slot.starts_at };
  });

  try {
    return insert.immediate();
  } catch (error) {
    throw translateConstraintError(error, database, clientId, slotId, "client");
  }
}

// Βρίσκει άλλο ενεργό ραντεβού του ίδιου ασκούμενου την ίδια ημέρα (ώρα Ελλάδας).
function findSameDayAppointment(
  database: Database,
  clientId: string,
  localDay: string,
  ignoreAppointmentId: string | null,
): { id: string; startsAt: string } | undefined {
  return database
    .prepare(
      `SELECT a.id, s.starts_at AS startsAt
       FROM appointments a JOIN slots s ON s.id = a.slot_id
       WHERE a.client_id = ? AND a.local_day = ? AND a.id IS NOT ?`,
    )
    .get(clientId, localDay, ignoreAppointmentId) as
    | { id: string; startsAt: string }
    | undefined;
}

function dayConflictError(
  database: Database,
  clientId: string,
  startsAt: string | null,
  perspective: Perspective,
): ApiError {
  const when = startsAt ? ` στις ${getLocalTime(startsAt)}` : "";
  if (perspective === "client") {
    return new ApiError(409, `Έχεις ήδη ραντεβού${when} αυτή τη μέρα.`, ALREADY_BOOKED_THAT_DAY);
  }
  const user = database.prepare("SELECT username FROM users WHERE id = ?").get(clientId) as
    | { username: string }
    | undefined;
  return new ApiError(
    409,
    `Ο ${user?.username ?? "ασκούμενος"} έχει ήδη ραντεβού${when} εκείνη τη μέρα.`,
    ALREADY_BOOKED_THAT_DAY,
  );
}

function assertClientFreeThatDay(
  database: Database,
  clientId: string,
  localDay: string,
  ignoreAppointmentId: string | null,
  perspective: Perspective,
): void {
  const existing = findSameDayAppointment(database, clientId, localDay, ignoreAppointmentId);
  if (existing) {
    throw dayConflictError(database, clientId, existing.startsAt, perspective);
  }
}

// Δίχτυ ασφαλείας: αν το index της βάσης απορρίψει κάτι που ο έλεγχος δεν πρόλαβε.
function translateConstraintError(
  error: unknown,
  database: Database,
  clientId: string,
  slotId: string,
  perspective: Perspective,
): unknown {
  if (!isUniqueConstraint(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("local_day")) {
    const slot = database
      .prepare("SELECT starts_at FROM slots WHERE id = ?")
      .get(slotId) as { starts_at: string } | undefined;
    const existing = slot
      ? findSameDayAppointment(database, clientId, getLocalDay(slot.starts_at), null)
      : undefined;
    return dayConflictError(database, clientId, existing?.startsAt ?? null, perspective);
  }
  return new ApiError(409, "Αυτή η ώρα έχει ήδη κλειστεί.");
}

// Ένα μόνο σημείο για μετακίνηση και/ή αλλαγή ασκούμενου, ώστε ο κανόνας να ισχύει παντού.
function updateAppointment(
  database: Database,
  appointment: AppointmentRecord,
  slotId: string,
  clientId: string,
  perspective: Perspective,
): void {
  const update = database.transaction(() => {
    const source = database
      .prepare("SELECT starts_at FROM slots WHERE id = ?")
      .get(appointment.slot_id) as { starts_at: string } | undefined;
    if (source && hasStarted(source.starts_at)) {
      throw appointmentInPastError();
    }

    const destination = database
      .prepare("SELECT id, starts_at FROM slots WHERE id = ? AND starts_at > ?")
      .get(slotId, new Date().toISOString()) as SlotRecord | undefined;
    if (!destination) {
      throw new ApiError(404, "Η διαθέσιμη ώρα δεν βρέθηκε.");
    }

    if (destination.id === appointment.slot_id && clientId === appointment.client_id) {
      return;
    }

    const localDay = getLocalDay(destination.starts_at);
    assertClientFreeThatDay(database, clientId, localDay, appointment.id, perspective);

    const occupied = database
      .prepare("SELECT id FROM appointments WHERE slot_id = ? AND id != ?")
      .get(slotId, appointment.id);
    if (occupied) {
      throw new ApiError(409, "Αυτή η ώρα έχει ήδη κλειστεί.");
    }
    database
      .prepare(
        `UPDATE appointments
         SET slot_id = ?, client_id = ?, legacy_client_name = NULL, local_day = ?
         WHERE id = ?`,
      )
      .run(slotId, clientId, localDay, appointment.id);
  });

  try {
    update.immediate();
  } catch (error) {
    throw translateConstraintError(error, database, clientId, slotId, perspective);
  }
}

// Η διαγραφή γίνεται με ένα μόνο statement που ελέγχει και την ώρα, ώστε να μην υπάρχει κενό
// ανάμεσα στον έλεγχο και τη διαγραφή.
function cancelUpcomingAppointment(
  database: Database,
  appointmentId: string,
  clientId: string | null,
): void {
  const result = database
    .prepare(
      `DELETE FROM appointments
       WHERE id = ? AND (? IS NULL OR client_id = ?)
         AND slot_id IN (SELECT id FROM slots WHERE starts_at > ?)`,
    )
    .run(appointmentId, clientId, clientId, new Date().toISOString());
  if (result.changes > 0) {
    return;
  }
  const exists = database
    .prepare("SELECT id FROM appointments WHERE id = ? AND (? IS NULL OR client_id = ?)")
    .get(appointmentId, clientId, clientId);
  throw exists ? appointmentInPastError() : new ApiError(404, "Το ραντεβού δεν βρέθηκε.");
}

export function createBookingRouter(database: Database): express.Router {
  const router = express.Router();

  router.get("/client/slots", requireRole(database, "client"), (request, response) => {
    const freeSlots = database
      .prepare(
        `SELECT s.id, s.starts_at AS startsAt
         FROM slots s
         LEFT JOIN appointments a ON a.slot_id = s.id
         WHERE a.id IS NULL AND s.starts_at > ?
         ORDER BY s.starts_at`,
      )
      .all(new Date().toISOString()) as { id: string; startsAt: string }[];
    const ownAppointments = database
      .prepare("SELECT id, local_day AS localDay FROM appointments WHERE client_id = ?")
      .all(request.session.user!.id) as { id: string; localDay: string }[];
    const ownByDay = new Map(ownAppointments.map((item) => [item.localDay, item.id]));

    // Δείχνουμε μόνο τα δικά του ραντεβού, ποτέ στοιχεία άλλων ασκούμενων.
    const slots = freeSlots.map((slot) => {
      const localDay = getLocalDay(slot.startsAt);
      const blockingAppointmentId = ownByDay.get(localDay) ?? null;
      return {
        ...slot,
        localDay,
        blockedReason: blockingAppointmentId ? ALREADY_BOOKED_THAT_DAY : null,
        blockingAppointmentId,
      };
    });
    response.json({ slots });
  });

  router.get("/client/appointments", requireRole(database, "client"), (request, response) => {
    const appointments = database
      .prepare(
        `SELECT a.id, a.slot_id AS slotId, s.starts_at AS startsAt, a.local_day AS localDay
         FROM appointments a
         JOIN slots s ON s.id = a.slot_id
         WHERE a.client_id = ?
         ORDER BY s.starts_at`,
      )
      .all(request.session.user!.id);
    response.json({ appointments });
  });

  router.post("/client/appointments", requireRole(database, "client"), (request, response) => {
    const slotId = getUuid(getBody(request).slotId, "Η διαθέσιμη ώρα");
    const appointment = insertAppointment(database, request.session.user!.id, slotId);
    response.status(201).json({ appointment });
  });

  router.patch(
    "/client/appointments/:id",
    requireRole(database, "client"),
    (request, response) => {
      const appointmentId = getAppointmentId(request);
      const requestedSlot = getBody(request).slotId;
      if (requestedSlot === undefined || requestedSlot === null || requestedSlot === "") {
        throw new ApiError(400, "Διάλεξε τη νέα ώρα.", "NEW_SLOT_REQUIRED");
      }
      const slotId = getUuid(requestedSlot, "Η νέα ώρα");
      const appointment = database
        .prepare(
          `SELECT id, slot_id, client_id
           FROM appointments WHERE id = ? AND client_id = ?`,
        )
        .get(appointmentId, request.session.user!.id) as AppointmentRecord | undefined;
      if (!appointment) {
        throw new ApiError(404, "Το ραντεβού δεν βρέθηκε.");
      }
      if (appointment.slot_id === slotId) {
        throw new ApiError(400, "Διάλεξε διαφορετική ώρα από την τρέχουσα.", "SAME_SLOT");
      }

      updateAppointment(
        database,
        appointment,
        slotId,
        request.session.user!.id,
        "client",
      );
      response.json({ message: "Η ώρα άλλαξε." });
    },
  );

  router.delete(
    "/client/appointments/:id",
    requireRole(database, "client"),
    (request, response) => {
      const appointmentId = getAppointmentId(request);
      cancelUpcomingAppointment(database, appointmentId, request.session.user!.id);
      response.status(204).end();
    },
  );

  router.get("/trainer/slots", requireRole(database, "trainer"), (_request, response) => {
    const slots = database
      .prepare(
        `SELECT s.id, s.starts_at AS startsAt, a.id AS appointmentId,
                a.client_id AS clientId, u.username AS clientUsername,
                a.legacy_client_name AS legacyClientName
         FROM slots s
         LEFT JOIN appointments a ON a.slot_id = s.id
         LEFT JOIN users u ON u.id = a.client_id
         ORDER BY s.starts_at`,
      )
      .all();
    response.json({ slots });
  });

  router.post("/trainer/slots", requireRole(database, "trainer"), (request, response) => {
    const startsAt = getStartsAt(getBody(request).startsAt);
    const slotId = randomUUID();
    try {
      database.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)").run(slotId, startsAt);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(409, "Υπάρχει ήδη διαθέσιμη ώρα σε αυτή την ημερομηνία.");
      }
      throw error;
    }
    response.status(201).json({ slot: { id: slotId, startsAt } });
  });

  router.delete(
    "/trainer/slots/:id",
    requireRole(database, "trainer"),
    (request, response) => {
      const slotId = getUuid(request.params.id, "Το αναγνωριστικό της ώρας");
      // Μια ώρα που έχει περάσει και έχει ραντεβού είναι ιστορικό και δεν διαγράφεται.
      const result = database
        .prepare(
          `DELETE FROM slots
           WHERE id = ? AND (starts_at > ?
             OR NOT EXISTS (SELECT 1 FROM appointments WHERE slot_id = slots.id))`,
        )
        .run(slotId, new Date().toISOString());
      if (result.changes === 0) {
        const exists = database.prepare("SELECT id FROM slots WHERE id = ?").get(slotId);
        throw exists ? appointmentInPastError() : new ApiError(404, "Η ώρα δεν βρέθηκε.");
      }
      response.status(204).end();
    },
  );

  router.patch(
    "/trainer/appointments/:id",
    requireRole(database, "trainer"),
    (request, response) => {
      const appointmentId = getAppointmentId(request);
      const body = getBody(request);
      const hasSlotId = Object.hasOwn(body, "slotId");
      const hasClientId = Object.hasOwn(body, "clientId");
      if (!hasSlotId && !hasClientId) {
        throw new ApiError(400, "Διάλεξε νέα ώρα ή ασκούμενο για το ραντεβού.");
      }

      const appointment = database
        .prepare("SELECT id, slot_id, client_id FROM appointments WHERE id = ?")
        .get(appointmentId) as AppointmentRecord | undefined;
      if (!appointment) {
        throw new ApiError(404, "Το ραντεβού δεν βρέθηκε.");
      }

      const destinationSlotId = hasSlotId
        ? getUuid(body.slotId, "Η διαθέσιμη ώρα")
        : appointment.slot_id;
      const clientId = hasClientId
        ? getUuid(body.clientId, "Ο ασκούμενος")
        : appointment.client_id;
      if (!clientId) {
        throw new ApiError(400, "Διάλεξε ασκούμενο για αυτό το παλιό ραντεβού.");
      }

      const client = database
        .prepare("SELECT id FROM users WHERE id = ? AND role = 'client' AND is_active = 1")
        .get(clientId);
      if (!client) {
        throw new ApiError(404, "Ο ασκούμενος δεν βρέθηκε ή είναι ανενεργός.");
      }

      updateAppointment(database, appointment, destinationSlotId, clientId, "trainer");
      response.json({ message: "Το ραντεβού ενημερώθηκε." });
    },
  );

  router.delete(
    "/trainer/appointments/:id",
    requireRole(database, "trainer"),
    (request, response) => {
      const appointmentId = getAppointmentId(request);
      cancelUpcomingAppointment(database, appointmentId, null);
      response.status(204).end();
    },
  );

  return router;
}

export function handleApiError(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  if (isUniqueConstraint(error)) {
    response.status(409).json({ error: "Η ώρα έχει ήδη κλειστεί ή υπάρχει ήδη." });
    return;
  }
  next(error);
}
