import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";

const username = "ai.kid.private";
const password = "ai-kid-password-1";
const year = new Date().getUTCFullYear() + 2;
const state = { baseUrl: "", directory: "", cookie: "", close: async () => {} };
let database: Database;

interface FakeRequest {
  system: string;
  messages: { content: string }[];
}
const captured: FakeRequest[] = [];
let nextToolInput: unknown = { reply: "Δοκίμασε την Πέμπτη.", slotId: null };

const fakeAnthropic = {
  messages: {
    create: async (request: FakeRequest) => {
      captured.push(request);
      return { content: [{ type: "tool_use", input: nextToolInput }] };
    },
  },
} as unknown as Anthropic;

// Ώρα Ελλάδας -> ISO UTC (χειμερινή ώρα, +2).
const athens = (month: number, day: number, hour: number) =>
  new Date(Date.UTC(year, month - 1, day, hour - 2)).toISOString();
const dayKey = (month: number, date: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

function addSlot(startsAt: string): string {
  const id = randomUUID();
  database.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)").run(id, startsAt);
  return id;
}

const ask = (message: unknown) =>
  fetch(`${state.baseUrl}/api/ai/slot-suggestion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: state.cookie },
    body: JSON.stringify({ message }),
  });

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-ai-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
  database
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, is_active) VALUES (?, ?, ?, 'client', 1)",
    )
    .run(randomUUID(), username, await bcrypt.hash(password, 4));
  const server = createServer(
    createApp(
      database,
      "test-session-secret-with-more-than-thirty-two-characters",
      fakeAnthropic,
      undefined,
      true,
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  };
  const login = await fetch(`${state.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  state.cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("το μοντέλο παίρνει μόνο το μήνυμα, τη σημερινή μέρα και ώρες που μπορεί να κλείσει ο ασκούμενος", async () => {
  const userId = (
    database.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string }
  ).id;
  const bookedSlot = addSlot(athens(4, 7, 18));
  database
    .prepare("INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), bookedSlot, userId, dayKey(4, 7));
  const sameDay = addSlot(athens(4, 7, 20));
  const otherDay = addSlot(athens(4, 8, 19));

  captured.length = 0;
  const response = await ask("αύριο απόγευμα");
  assert.equal(response.status, 200);

  const request = captured[0];
  const payload = JSON.parse(request.messages[0].content) as {
    request: string;
    today: { localDay: string; tomorrowLocalDay: string };
    availableSlots: { id: string }[];
  };
  const ids = payload.availableSlots.map((slot) => slot.id);
  assert.deepEqual(ids, [otherDay]);
  assert.ok(!ids.includes(sameDay), "ώρα σε μέρα με ήδη ραντεβού δεν στέλνεται στο μοντέλο");
  assert.match(payload.today.localDay, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(payload.today.localDay, payload.today.tomorrowLocalDay);

  const everythingSent = JSON.stringify(request);
  assert.ok(!everythingSent.includes(username), "το όνομα χρήστη δεν στέλνεται στο μοντέλο");
  assert.ok(!everythingSent.includes(userId), "το id του χρήστη δεν στέλνεται στο μοντέλο");
  assert.match(request.system, /προσωπικά στοιχεία/);
  assert.match(request.system, /σύντομα/);
});

test("ώρα που δεν υπάρχει στη λίστα απορρίπτεται, ενώ το null (εκτός θέματος) περνά", async () => {
  nextToolInput = { reply: "Να η ώρα.", slotId: randomUUID() };
  const invented = await ask("Τετάρτη");
  assert.equal(invented.status, 502);

  nextToolInput = { reply: "Βοηθάω μόνο με ραντεβού προπόνησης.", slotId: null };
  const offTopic = await ask("ποια είναι η πρωτεύουσα της Γαλλίας;");
  assert.equal(offTopic.status, 200);
  assert.deepEqual(await offTopic.json(), {
    reply: "Βοηθάω μόνο με ραντεβού προπόνησης.",
    slotId: null,
  });
});

test("το μήνυμα έχει όριο 200 χαρακτήρων", async () => {
  assert.equal((await ask("α".repeat(200))).status, 200);
  const tooLong = await ask("α".repeat(201));
  assert.equal(tooLong.status, 400);
  assert.equal(((await tooLong.json()) as { error: string }).error, "Το μήνυμα πρέπει να έχει 1 έως 200 χαρακτήρες.");
});

test("το endpoint AI είναι κλειστό από προεπιλογή και δεν καλεί provider", async () => {
  const server = createServer(
    createApp(
      database,
      "test-session-secret-with-more-than-thirty-two-characters",
      fakeAnthropic,
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const callsBefore = captured.length;
  try {
    const response = await fetch(`${baseUrl}/api/ai/slot-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: state.cookie },
      body: JSON.stringify({ message: "Αύριο απόγευμα" }),
    });
    assert.equal(response.status, 503);
    assert.equal(captured.length, callsBefore);
    assert.match(((await response.json()) as { error: string }).error, /δεν είναι διαθέσιμος/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
