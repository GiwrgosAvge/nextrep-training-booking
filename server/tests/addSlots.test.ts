import assert from "node:assert/strict";
import { once } from "node:events";
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
import {
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  addHoursLabel,
  addPickedTime,
  checkPickedTime,
  toDate,
} from "../../client/src/slotPicker.ts";

const trainerUsername = "trainer.slots";
const trainerPassword = "trainer-slots-password";
const state: { baseUrl: string; directory: string; database: Database | null; close: () => Promise<void> } = {
  baseUrl: "",
  directory: "",
  database: null,
  close: async () => {},
};
let trainerCookie = "";

async function postSlot(startsAt: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${state.baseUrl}/api/trainer/slots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: trainerCookie },
    body: JSON.stringify({ startsAt }),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-slots-test-"));
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
  const response = await fetch(`${state.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: trainerUsername, password: trainerPassword }),
  });
  trainerCookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

const hoursFromNow = (count: number) => new Date(Date.now() + count * 3_600_000).toISOString();

test("the picker offers 24-hour hours and 5-minute steps only", () => {
  assert.equal(HOUR_OPTIONS.length, 24);
  assert.equal(HOUR_OPTIONS[0], "00");
  assert.equal(HOUR_OPTIONS[23], "23");
  assert.deepEqual(MINUTE_OPTIONS, ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
});

test("addHoursLabel uses the correct Greek plural", () => {
  assert.equal(addHoursLabel(1), "Πρόσθεσε 1 ώρα");
  assert.equal(addHoursLabel(3), "Πρόσθεσε 3 ώρες");
});

test("addPickedTime keeps the list sorted and without duplicates", () => {
  assert.deepEqual(addPickedTime(["09:00", "16:30"], "12:00"), ["09:00", "12:00", "16:30"]);
  assert.deepEqual(addPickedTime(["09:00"], "09:00"), ["09:00"]);
});

test("checkPickedTime rejects past, already existing and already selected times", () => {
  const day = "2030-06-10";
  const now = toDate(day, "12:00").getTime();
  const taken = new Set(["15:00"]);

  assert.deepEqual(checkPickedTime(day, "", "30", now, taken, []), { time: null, problem: "incomplete" });
  assert.deepEqual(checkPickedTime(day, "09", "30", now, taken, []), { time: null, problem: "past" });
  assert.deepEqual(checkPickedTime(day, "12", "00", now, taken, []), { time: null, problem: "past" });
  assert.deepEqual(checkPickedTime(day, "15", "00", now, taken, []), { time: null, problem: "taken" });
  assert.deepEqual(checkPickedTime(day, "16", "30", now, taken, ["16:30"]), {
    time: null,
    problem: "selected",
  });
  assert.deepEqual(checkPickedTime(day, "16", "30", now, taken, ["17:00"]), {
    time: "16:30",
    problem: null,
  });
});

test("server accepts several hours added one after another", async () => {
  const starts = [hoursFromNow(48), hoursFromNow(49), hoursFromNow(50)];
  for (const startsAt of starts) {
    const result = await postSlot(startsAt);
    assert.equal(result.status, 201);
  }
  const count = state.database!.prepare("SELECT COUNT(*) AS count FROM slots").get() as { count: number };
  assert.equal(count.count, 3);
});

test("server rejects a past hour (400) and an existing hour (409)", async () => {
  const past = await postSlot(hoursFromNow(-2));
  assert.equal(past.status, 400);

  const startsAt = hoursFromNow(72);
  assert.equal((await postSlot(startsAt)).status, 201);
  const duplicate = await postSlot(startsAt);
  assert.equal(duplicate.status, 409);
  assert.match(String(duplicate.data.error), /Υπάρχει ήδη/);
});
