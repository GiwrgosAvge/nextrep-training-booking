import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Database } from "better-sqlite3";
import { createApp } from "../src/app.js";
import { ensureInitialTrainer } from "../src/auth.js";
import { createDatabase } from "../src/database.js";

const trainerUsername = "trainer.edit";
const trainerPassword = "trainer-edit-password";
const year = new Date().getUTCFullYear() + 2;
const state: { baseUrl: string; directory: string; database: Database | null; close: () => Promise<void> } = {
  baseUrl: "",
  directory: "",
  database: null,
  close: async () => {},
};
let trainerCookie = "";

interface Result {
  status: number;
  data: Record<string, unknown>;
  cookie: string | null;
}

// Ώρα Ελλάδας -> ISO UTC (χειμερινή ώρα, +2).
const athens = (month: number, day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour - 2, minute)).toISOString();

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

// Το login έχει όριο 5 ανά λεπτό: μόνο όσοι κλείνουν ραντεβού μέσω API συνδέονται, οι υπόλοιποι γράφονται απευθείας στη βάση.
function createAccountOnly(username: string): string {
  const id = randomUUID();
  state.database!
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, is_active) VALUES (?, ?, 'x', 'client', 1)",
    )
    .run(id, username);
  return id;
}

function insertAppointment(clientId: string, startsAt: string, localDay: string): string {
  const slotId = randomUUID();
  const appointmentId = randomUUID();
  state.database!.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)").run(slotId, startsAt);
  state.database!
    .prepare("INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)")
    .run(appointmentId, slotId, clientId, localDay);
  return appointmentId;
}

async function createSlot(startsAt: string): Promise<string> {
  const result = await send("/api/trainer/slots", {
    method: "POST",
    cookie: trainerCookie,
    body: { startsAt },
  });
  assert.equal(result.status, 201);
  return (result.data.slot as { id: string }).id;
}

const edit = (appointmentId: string, body: Record<string, string>) =>
  send(`/api/trainer/appointments/${appointmentId}`, {
    method: "PATCH",
    cookie: trainerCookie,
    body,
  });

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-edit-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  const database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
  state.database = database;
  await ensureInitialTrainer(database, trainerUsername, trainerPassword);
  const server = createServer(
    createApp(database, "test-session-secret-with-more-than-thirty-two-characters", null),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  };
  const login = await send("/api/auth/login", {
    method: "POST",
    body: { username: trainerUsername, password: trainerPassword },
  });
  trainerCookie = login.cookie as string;
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

const day = (month: number, date: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

test("moving to a day where the same client already has an appointment returns 409 with the name", () => {
  const kid = createAccountOnly("avgeris");
  const first = insertAppointment(kid, athens(2, 10, 15), day(2, 10));
  insertAppointment(kid, athens(2, 11, 18), day(2, 11));
  return createSlot(athens(2, 11, 20)).then(async (target) => {
    const result = await edit(first, { slotId: target });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, "ALREADY_BOOKED_THAT_DAY");
    assert.equal(result.data.error, "Ο avgeris έχει ήδη ραντεβού στις 18:00 εκείνη τη μέρα.");
  });
});

test("moving to another hour on the same day is allowed", async () => {
  const kid = createAccountOnly("same.day");
  const appointment = insertAppointment(kid, athens(2, 12, 15), day(2, 12));
  const result = await edit(appointment, { slotId: await createSlot(athens(2, 12, 18)) });
  assert.equal(result.status, 200);
});

test("changing the client to someone free that day is allowed, to someone busy is rejected", async () => {
  const owner = createAccountOnly("owner.kid");
  const free = createAccountOnly("free.kid");
  const busy = createAccountOnly("busy.kid");
  const appointment = insertAppointment(owner, athens(2, 13, 15), day(2, 13));
  insertAppointment(busy, athens(2, 13, 19), day(2, 13));

  const rejected = await edit(appointment, { clientId: busy });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.code, "ALREADY_BOOKED_THAT_DAY");

  const allowed = await edit(appointment, { clientId: free });
  assert.equal(allowed.status, 200);
  const row = state.database!
    .prepare("SELECT client_id FROM appointments WHERE id = ?")
    .get(appointment) as { client_id: string };
  assert.equal(row.client_id, free);
});

test("an appointment that already passed cannot be edited", async () => {
  const kid = createAccountOnly("past.edit");
  const past = insertAppointment(kid, new Date(Date.now() - 5 * 3_600_000).toISOString(), "past-edit-day");
  const result = await edit(past, { slotId: await createSlot(athens(2, 14, 15)) });
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "APPOINTMENT_IN_PAST");
});

