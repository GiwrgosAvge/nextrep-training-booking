import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Database } from "better-sqlite3";
import { createApp } from "../src/app.js";
import { hasStarted } from "../src/appointmentTime.js";
import { ensureInitialTrainer } from "../src/auth.js";
import { createDatabase } from "../src/database.js";
import {
  appointmentCount,
  freeBadgeLabel,
  freeHoursCount,
  getInitials,
  isPastStart,
  partitionByTime,
  upcomingAppointmentsCount,
} from "../../client/src/appointmentTime.ts";

const trainerUsername = "trainer.past";
const trainerPassword = "trainer-past-password";
const clientPassword = "new-client-password-123";
const state: { baseUrl: string; directory: string; database: Database | null; close: () => Promise<void> } = {
  baseUrl: "",
  directory: "",
  database: null,
  close: async () => {},
};
let trainerCookie = "";
let clientCookie = "";
let clientId = "";

interface Result {
  status: number;
  data: Record<string, unknown>;
  cookie: string | null;
}

const hours = (count: number) => new Date(Date.now() + count * 3_600_000).toISOString();

async function send(
  route: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Result> {
  const response = await fetch(`${state.baseUrl}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const data = (response.status === 204 ? {} : await response.json()) as Record<string, unknown>;
  const setCookie = response.headers.get("set-cookie");
  return {
    status: response.status,
    data,
    cookie: setCookie ? setCookie.split(";")[0] : (options.cookie ?? null),
  };
}

async function login(username: string, password: string): Promise<string> {
  const result = await send("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
}

// Το API δεν επιτρέπει δημιουργία ώρας στο παρελθόν, γι' αυτό τα παλιά δεδομένα μπαίνουν απευθείας στη βάση.
function insertSlot(startsAt: string, booked: boolean): { slotId: string; appointmentId: string | null } {
  const database = state.database!;
  const slotId = randomUUID();
  database.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)").run(slotId, startsAt);
  if (!booked) {
    return { slotId, appointmentId: null };
  }
  const appointmentId = randomUUID();
  database
    .prepare("INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)")
    .run(appointmentId, slotId, clientId, `test-${appointmentId}`);
  return { slotId, appointmentId };
}

const appointmentExists = (id: string | null) =>
  state.database!.prepare("SELECT 1 FROM appointments WHERE id = ?").get(id) !== undefined;

function assertPastRejected(result: Result): void {
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "APPOINTMENT_IN_PAST");
  assert.match(String(result.data.error), /έχει ήδη περάσει/);
}

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-past-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  const database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
  state.database = database;
  await ensureInitialTrainer(database, trainerUsername, trainerPassword);
  const app = createApp(database, "test-session-secret-with-more-than-thirty-two-characters", null);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  };

  trainerCookie = await login(trainerUsername, trainerPassword);
  const created = await send("/api/trainer/clients", {
    method: "POST",
    cookie: trainerCookie,
    body: { username: "past.client" },
  });
  const temporaryPassword = created.data.temporaryPassword as string;
  clientCookie = await login("past.client", temporaryPassword);
  await send("/api/auth/change-password", {
    method: "POST",
    cookie: clientCookie,
    body: { password: temporaryPassword, newPassword: clientPassword },
  });
  clientId = (database.prepare("SELECT id FROM users WHERE username = ?").get("past.client") as {
    id: string;
  }).id;
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("isPastStart: past, exactly now, future and invalid values", () => {
  const now = Date.parse("2030-03-31T09:00:00.000Z");
  assert.equal(isPastStart("2030-03-31T08:59:59.999Z", now), true);
  assert.equal(isPastStart("2030-03-31T09:00:00.000Z", now), true);
  assert.equal(isPastStart("2030-03-31T09:00:00.001Z", now), false);
  assert.equal(isPastStart("not-a-date", now), true);
  assert.equal(hasStarted("2030-03-31T09:00:00.000Z", now), true);
  assert.equal(hasStarted("2030-03-31T09:00:00.001Z", now), false);
});

test("partitionByTime keeps counts consistent: yesterday, this morning, tonight, future", () => {
  // 15:00 ώρα Ελλάδας (UTC+3 το καλοκαίρι) στις 15 Ιουλίου.
  const now = Date.parse("2030-07-15T12:00:00.000Z");
  const items = [
    { startsAt: "2030-07-14T15:00:00.000Z" },
    { startsAt: "2030-07-15T06:00:00.000Z" },
    { startsAt: "2030-07-15T17:00:00.000Z" },
    { startsAt: "2030-07-16T07:00:00.000Z" },
  ];
  const { upcoming, past } = partitionByTime(items, now);
  assert.equal(upcoming.length, 2);
  assert.equal(past.length, 2);
  assert.equal(upcoming[0].startsAt, "2030-07-15T17:00:00.000Z");
  assert.equal(past[0].startsAt, "2030-07-15T06:00:00.000Z");
  assert.equal(upcoming.length + past.length, items.length);
});

test("Greek plural helpers", () => {
  assert.equal(freeHoursCount(1), "1 ελεύθερη ώρα");
  assert.equal(freeHoursCount(2), "2 ελεύθερες ώρες");
  assert.equal(freeHoursCount(0), "0 ελεύθερες ώρες");
  assert.equal(freeBadgeLabel(1), "1 ελεύθερη");
  assert.equal(freeBadgeLabel(3), "3 ελεύθερες");
  assert.equal(appointmentCount(1), "1 ραντεβού");
  assert.equal(appointmentCount(5), "5 ραντεβού");
  assert.equal(upcomingAppointmentsCount(1), "1 επόμενο ραντεβού");
  assert.equal(upcomingAppointmentsCount(3), "3 επόμενα ραντεβού");
});

test("getInitials", () => {
  assert.equal(getInitials("maria_papadopoulou"), "MP");
  assert.equal(getInitials("Γιώργος Νικολάου"), "ΓΝ");
  assert.equal(getInitials("nikos"), "NI");
});

test("trainer cannot move a past appointment", async () => {
  const past = insertSlot(hours(-5), true);
  const future = insertSlot(hours(48), false);
  const result = await send(`/api/trainer/appointments/${past.appointmentId}`, {
    method: "PATCH",
    cookie: trainerCookie,
    body: { slotId: future.slotId },
  });
  assertPastRejected(result);
});

test("client cannot move or cancel a past appointment", async () => {
  const past = insertSlot(hours(-30), true);
  const future = insertSlot(hours(72), false);
  assertPastRejected(
    await send(`/api/client/appointments/${past.appointmentId}`, {
      method: "PATCH",
      cookie: clientCookie,
      body: { slotId: future.slotId },
    }),
  );
  assertPastRejected(
    await send(`/api/client/appointments/${past.appointmentId}`, {
      method: "DELETE",
      cookie: clientCookie,
    }),
  );
  assert.equal(appointmentExists(past.appointmentId), true);
});

test("trainer cannot cancel a past appointment or delete its hour", async () => {
  const past = insertSlot(hours(-2), true);
  assertPastRejected(
    await send(`/api/trainer/appointments/${past.appointmentId}`, {
      method: "DELETE",
      cookie: trainerCookie,
    }),
  );
  assertPastRejected(
    await send(`/api/trainer/slots/${past.slotId}`, { method: "DELETE", cookie: trainerCookie }),
  );
  assert.equal(appointmentExists(past.appointmentId), true);
});

test("a past free hour can be cleaned up, a future appointment can still be cancelled", async () => {
  const pastFree = insertSlot(hours(-3), false);
  const removed = await send(`/api/trainer/slots/${pastFree.slotId}`, {
    method: "DELETE",
    cookie: trainerCookie,
  });
  assert.equal(removed.status, 204);

  const future = insertSlot(hours(24), true);
  const cancelled = await send(`/api/client/appointments/${future.appointmentId}`, {
    method: "DELETE",
    cookie: clientCookie,
  });
  assert.equal(cancelled.status, 204);
  assert.equal(appointmentExists(future.appointmentId), false);
});

test("unknown appointment still returns 404", async () => {
  const result = await send(`/api/trainer/appointments/${randomUUID()}`, {
    method: "DELETE",
    cookie: trainerCookie,
  });
  assert.equal(result.status, 404);
});
