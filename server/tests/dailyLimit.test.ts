import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { ensureInitialTrainer } from "../src/auth.js";
import { createDatabase } from "../src/database.js";

const trainerUsername = "trainer.daily";
const trainerPassword = "trainer-daily-password";
const clientPassword = "new-client-password-123";
const year = new Date().getUTCFullYear() + 1;
const state: { baseUrl: string; directory: string; close: () => Promise<void> } = {
  baseUrl: "",
  directory: "",
  close: async () => {},
};
const aiCalls: unknown[] = [];
let trainerCookie = "";

interface Result {
  status: number;
  data: Record<string, unknown>;
  cookie: string | null;
}

// Ώρα Ελλάδας -> ISO UTC. Το offset δίνεται ρητά (+2 χειμώνας, +3 καλοκαίρι).
function athens(month: number, day: number, hour: number, minute: number, offset: number): string {
  return new Date(Date.UTC(year, month - 1, day, hour - offset, minute)).toISOString();
}

function lastSunday(month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

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

// Το login έχει όριο 5 ανά λεπτό, γι' αυτό τα τεστ μοιράζονται λίγους ασκούμενους (κάθε τεστ έχει δική του μέρα).
const cachedClients = new Map<number, string>();

async function createClient(index = 0): Promise<string> {
  const cached = cachedClients.get(index);
  if (cached) {
    return cached;
  }
  const username = `daily.client.${index}`;
  const created = await send("/api/trainer/clients", {
    method: "POST",
    cookie: trainerCookie,
    body: { username },
  });
  assert.equal(created.status, 201);
  const temporaryPassword = created.data.temporaryPassword as string;
  const cookie = await login(username, temporaryPassword);
  const changed = await send("/api/auth/change-password", {
    method: "POST",
    cookie,
    body: { password: temporaryPassword, newPassword: clientPassword },
  });
  assert.equal(changed.status, 200);
  cachedClients.set(index, cookie);
  return cookie;
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

function book(cookie: string, slotId: string): Promise<Result> {
  return send("/api/client/appointments", { method: "POST", cookie, body: { slotId } });
}

async function bookOk(cookie: string, slotId: string): Promise<string> {
  const result = await book(cookie, slotId);
  assert.equal(result.status, 201);
  return (result.data.appointment as { id: string }).id;
}

function assertDayConflict(result: Result, message?: string): void {
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "ALREADY_BOOKED_THAT_DAY");
  if (message) {
    assert.equal(result.data.error, message);
  }
}

const fakeAnthropic = {
  messages: {
    create: async (request: unknown) => {
      aiCalls.push(request);
      return {
        content: [
          { type: "tool_use", input: { reply: "Δοκίμασε μια άλλη μέρα.", slotId: null } },
        ],
      };
    },
  },
} as unknown as Anthropic;

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-daily-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  const database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
  await ensureInitialTrainer(database, trainerUsername, trainerPassword);
  const app = createApp(
    database,
    "test-session-secret-with-more-than-thirty-two-characters",
    fakeAnthropic,
    undefined,
    true,
  );
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
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("rejects a second appointment on the same Athens day with 409", async () => {
  const client = await createClient();
  const first = await createSlot(athens(1, 10, 15, 0, 2));
  const second = await createSlot(athens(1, 10, 18, 0, 2));
  await bookOk(client, first);
  assertDayConflict(await book(client, second), "Έχεις ήδη ραντεβού στις 15:00 αυτή τη μέρα.");
});

test("23:30 and 00:30 Athens time are different days", async () => {
  const client = await createClient();
  const late = await createSlot(athens(1, 11, 23, 30, 2));
  const early = await createSlot(athens(1, 12, 0, 30, 2));
  // Στο UTC και τα δύο είναι 11 Ιανουαρίου, στην Ελλάδα όχι.
  assert.equal(athens(1, 11, 23, 30, 2).slice(0, 10), athens(1, 12, 0, 30, 2).slice(0, 10));
  await bookOk(client, late);
  await bookOk(client, early);
});

test("cancelling frees the day for a new booking", async () => {
  const client = await createClient();
  const first = await createSlot(athens(1, 13, 15, 0, 2));
  const second = await createSlot(athens(1, 13, 18, 0, 2));
  const appointmentId = await bookOk(client, first);
  const cancelled = await send(`/api/client/appointments/${appointmentId}`, {
    method: "DELETE",
    cookie: client,
  });
  assert.equal(cancelled.status, 204);
  await bookOk(client, second);
});

test("moving within the same day is allowed, moving to a booked day is rejected", async () => {
  const client = await createClient();
  const sameDayOther = await createSlot(athens(1, 14, 18, 0, 2));
  const original = await createSlot(athens(1, 14, 15, 0, 2));
  const otherDayFirst = await createSlot(athens(1, 15, 15, 0, 2));
  const otherDaySecond = await createSlot(athens(1, 15, 18, 0, 2));
  const appointmentId = await bookOk(client, original);
  await bookOk(client, otherDayFirst);

  const moved = await send(`/api/client/appointments/${appointmentId}`, {
    method: "PATCH",
    cookie: client,
    body: { slotId: sameDayOther },
  });
  assert.equal(moved.status, 200);

  const rejected = await send(`/api/client/appointments/${appointmentId}`, {
    method: "PATCH",
    cookie: client,
    body: { slotId: otherDaySecond },
  });
  assertDayConflict(rejected, "Έχεις ήδη ραντεβού στις 15:00 αυτή τη μέρα.");

  // Μετά τη μετακίνηση η παλιά ώρα ελευθερώνεται και η μέρα μένει δεσμευμένη μία φορά.
  const list = await send("/api/client/appointments", { cookie: client });
  const days = (list.data.appointments as { localDay: string }[])
    .map((item) => item.localDay)
    .filter((day) => day === `${year}-01-14` || day === `${year}-01-15`);
  assert.deepEqual(days.sort(), [`${year}-01-14`, `${year}-01-15`]);
});

test("changing the hour without a new hour or with the current hour is rejected", async () => {
  const client = await createClient();
  const original = await createSlot(athens(1, 22, 15, 0, 2));
  const appointmentId = await bookOk(client, original);
  const url = `/api/client/appointments/${appointmentId}`;

  const missing = await send(url, { method: "PATCH", cookie: client, body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.code, "NEW_SLOT_REQUIRED");
  assert.equal(missing.data.error, "Διάλεξε τη νέα ώρα.");

  const same = await send(url, { method: "PATCH", cookie: client, body: { slotId: original } });
  assert.equal(same.status, 400);
  assert.equal(same.data.code, "SAME_SLOT");
});

test("two simultaneous bookings of the same client on one day: only one passes", async () => {
  const client = await createClient();
  const first = await createSlot(athens(1, 16, 15, 0, 2));
  const second = await createSlot(athens(1, 16, 18, 0, 2));
  const results = await Promise.all([book(client, first), book(client, second)]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
  const conflict = results.find((item) => item.status === 409);
  assert.equal(conflict?.data.code, "ALREADY_BOOKED_THAT_DAY");
});

test("another client can book the same day and sees no foreign data", async () => {
  const clientA = await createClient(0);
  const clientB = await createClient(1);
  const first = await createSlot(athens(1, 17, 15, 0, 2));
  const second = await createSlot(athens(1, 17, 18, 0, 2));
  await bookOk(clientA, first);
  await bookOk(clientB, second);

  const slotsForA = await send("/api/client/slots", { cookie: clientA });
  assert.equal(slotsForA.status, 200);
  const ids = (slotsForA.data.slots as { id: string }[]).map((slot) => slot.id);
  assert.equal(ids.includes(first), false);
  assert.equal(ids.includes(second), false);
  assert.ok(!JSON.stringify(slotsForA.data).includes("daily.client"));
});

test("free slot list marks blocked hours for the booked day only", async () => {
  const client = await createClient();
  const booked = await createSlot(athens(1, 18, 15, 0, 2));
  const sameDay = await createSlot(athens(1, 18, 18, 0, 2));
  const otherDay = await createSlot(athens(1, 19, 18, 0, 2));
  const appointmentId = await bookOk(client, booked);

  const result = await send("/api/client/slots", { cookie: client });
  const slots = result.data.slots as Record<string, unknown>[];
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  assert.equal(byId.has(booked), false);
  assert.equal(byId.get(sameDay)?.blockedReason, "ALREADY_BOOKED_THAT_DAY");
  assert.equal(byId.get(sameDay)?.blockingAppointmentId, appointmentId);
  assert.equal(byId.get(otherDay)?.blockedReason, null);
  assert.deepEqual(Object.keys(byId.get(sameDay) ?? {}).sort(), [
    "blockedReason",
    "blockingAppointmentId",
    "id",
    "localDay",
    "startsAt",
  ]);
});

test("trainer moves obey the same rule with a clear message", async () => {
  const client = await createClient();
  const dayOne = await createSlot(athens(1, 20, 15, 0, 2));
  const dayTwoFirst = await createSlot(athens(1, 21, 15, 0, 2));
  const dayTwoSecond = await createSlot(athens(1, 21, 18, 0, 2));
  const appointmentId = await bookOk(client, dayOne);
  await bookOk(client, dayTwoFirst);

  const result = await send(`/api/trainer/appointments/${appointmentId}`, {
    method: "PATCH",
    cookie: trainerCookie,
    body: { slotId: dayTwoSecond },
  });
  assertDayConflict(result, "Ο daily.client.0 έχει ήδη ραντεβού στις 15:00 εκείνη τη μέρα.");
});

test("daylight saving change in spring: local days stay correct", async () => {
  const day = lastSunday(3);
  const client = await createClient();
  const previousNight = await createSlot(athens(3, day - 1, 23, 30, 2));
  const earlyMorning = await createSlot(athens(3, day, 0, 30, 2));
  const evening = await createSlot(athens(3, day, 23, 30, 3));
  await bookOk(client, previousNight);
  await bookOk(client, earlyMorning);
  assertDayConflict(await book(client, evening));
});

test("daylight saving change in autumn: a 24h gap can still be the same day", async () => {
  const day = lastSunday(10);
  const client = await createClient();
  const earlyIso = athens(10, day, 0, 30, 3);
  const eveningIso = athens(10, day, 23, 30, 2);
  const earlyMorning = await createSlot(earlyIso);
  const evening = await createSlot(eveningIso);
  const nextNight = await createSlot(athens(10, day + 1, 0, 30, 2));
  assert.equal(Date.parse(eveningIso) - Date.parse(earlyIso), 24 * 60 * 60 * 1000);
  await bookOk(client, earlyMorning);
  assertDayConflict(await book(client, evening));
  await bookOk(client, nextNight);
});

test("AI assistant only receives hours the client can book, without names", async () => {
  const client = await createClient();
  const booked = await createSlot(athens(2, 3, 15, 0, 2));
  const blocked = await createSlot(athens(2, 3, 18, 0, 2));
  const free = await createSlot(athens(2, 4, 18, 0, 2));
  await bookOk(client, booked);

  aiCalls.length = 0;
  const result = await send("/api/ai/slot-suggestion", {
    method: "POST",
    cookie: client,
    body: { message: "Θέλω απόγευμα Τρίτης" },
  });
  assert.equal(result.status, 200);
  const payload = JSON.stringify(aiCalls[0]);
  assert.ok(payload.includes(free));
  assert.ok(!payload.includes(blocked));
  assert.ok(!payload.includes("daily.client"));
  assert.ok(payload.includes("bookedDays"));
});

test("startup migration refuses existing data that breaks the rule", async () => {
  const databasePath = path.join(state.directory, "old.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO schema_migrations (name) VALUES ('import-legacy-slots-v1');
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE slots (id TEXT PRIMARY KEY, starts_at TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE appointments (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
      client_id TEXT, legacy_client_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'maria', 'x', 'client');
    INSERT INTO slots (id, starts_at) VALUES ('s1', '2027-01-10T13:00:00.000Z'), ('s2', '2027-01-10T16:00:00.000Z');
    INSERT INTO appointments (id, slot_id, client_id) VALUES ('a1', 's1', 'u1'), ('a2', 's2', 'u1');
  `);
  legacy.close();

  assert.throws(
    () => createDatabase(databasePath, path.join(state.directory, "legacy.json")),
    /maria \(2027-01-10: 2 ραντεβού\)/,
  );

  const inspect = new Database(databasePath);
  const columns = inspect.prepare("PRAGMA table_info(appointments)").all() as { name: string }[];
  inspect.close();
  assert.equal(columns.some((column) => column.name === "local_day"), false);
});
