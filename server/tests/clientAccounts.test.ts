import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_LENGTH,
  createTemporaryPassword,
} from "../src/temporaryPassword.js";

const trainerUsername = "trainer.accounts";
const trainerPassword = "trainer-accounts-password";
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

async function login(username: string, password: string): Promise<Result> {
  return send("/api/auth/login", { method: "POST", body: { username, password } });
}

async function createClient(username: string): Promise<{ id: string; password: string }> {
  const result = await send("/api/trainer/clients", {
    method: "POST",
    cookie: trainerCookie,
    body: { username },
  });
  assert.equal(result.status, 201);
  return {
    id: (result.data.client as { id: string }).id,
    password: result.data.temporaryPassword as string,
  };
}

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-accounts-test-"));
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
  trainerCookie = (await login(trainerUsername, trainerPassword)).cookie ?? "";
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("temporary passwords are 12 easy characters without confusing ones", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const password = createTemporaryPassword();
    seen.add(password);
    assert.equal(password.length, TEMPORARY_PASSWORD_LENGTH);
    assert.match(password, /^[a-z0-9]+$/);
    assert.doesNotMatch(password, /[01oli]/);
    for (const character of password) {
      assert.ok(TEMPORARY_PASSWORD_ALPHABET.includes(character));
    }
  }
  assert.equal(seen.size, 200);
});

test("a client gets 403 on every account management endpoint", async () => {
  const target = await createClient("target.child");
  const actor = await createClient("acting.child");
  const clientCookie = (await login("acting.child", actor.password)).cookie!;
  await send("/api/auth/change-password", {
    method: "POST",
    cookie: clientCookie,
    body: { password: actor.password, newPassword: "my-own-new-password-1" },
  });

  const attempts: Array<[string, string, unknown?]> = [
    ["GET", "/api/trainer/clients"],
    ["POST", "/api/trainer/clients", { username: "sneaky.user" }],
    ["PATCH", `/api/trainer/clients/${target.id}`, { isActive: false }],
    ["POST", `/api/trainer/clients/${target.id}/reset-password`],
    ["DELETE", `/api/trainer/clients/${target.id}`],
  ];
  for (const [method, route, body] of attempts) {
    const result = await send(route, { method, cookie: clientCookie, body });
    assert.equal(result.status, 403, `${method} ${route} must reject a client`);
    assert.equal(result.data.temporaryPassword, undefined);
  }
  assert.ok(state.database!.prepare("SELECT 1 FROM users WHERE id = ?").get(target.id));
  assert.equal(state.database!.prepare("SELECT 1 FROM users WHERE username = ?").get("sneaky.user"), undefined);
});

test("a client with a temporary password is blocked until the password is changed", async () => {
  const created = await createClient("first.login");
  const cookie = (await login("first.login", created.password)).cookie!;
  const blocked = await send("/api/client/slots", { cookie });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await send("/api/auth/change-password", {
    method: "POST",
    cookie,
    body: { password: created.password, newPassword: "a-brand-new-password-1" },
  });
  assert.equal(changed.status, 200);
  assert.equal((await send("/api/client/slots", { cookie })).status, 200);
});

test("the temporary password is returned once and never stored in plain text", async () => {
  const created = await createClient("secret.keeper");
  const database = state.database!;
  const dump = JSON.stringify([
    database.prepare("SELECT * FROM users").all(),
    database.prepare("SELECT * FROM sessions").all(),
    database.prepare("SELECT * FROM appointments").all(),
  ]);
  assert.ok(!dump.includes(created.password));

  const list = await send("/api/trainer/clients", { cookie: trainerCookie });
  assert.ok(!JSON.stringify(list.data).includes(created.password));

  const reset = await send(`/api/trainer/clients/${created.id}/reset-password`, {
    method: "POST",
    cookie: trainerCookie,
  });
  const newPassword = reset.data.temporaryPassword as string;
  assert.notEqual(newPassword, created.password);
  assert.equal((await login("secret.keeper", created.password)).status, 401);
  assert.equal((await login("secret.keeper", newPassword)).status, 200);
  const afterReset = JSON.stringify(database.prepare("SELECT * FROM users").all());
  assert.ok(!afterReset.includes(newPassword));
});

test("deleting an account cancels future appointments and keeps the history", async () => {
  const created = await createClient("leaving.client");
  const database = state.database!;
  const insert = (startsAt: string, localDay: string) => {
    const slotId = randomUUID();
    database.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)").run(slotId, startsAt);
    database
      .prepare("INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), slotId, created.id, localDay);
    return slotId;
  };
  const pastSlot = insert(new Date(Date.now() - 48 * 3_600_000).toISOString(), "2000-01-01");
  const futureSlot = insert(new Date(Date.now() + 48 * 3_600_000).toISOString(), "2999-01-01");

  const list = await send("/api/trainer/clients", { cookie: trainerCookie });
  const listed = (list.data.clients as Array<Record<string, unknown>>).find((c) => c.id === created.id)!;
  assert.equal(listed.appointmentCount, 2);
  assert.equal(listed.upcomingAppointmentCount, 1);

  const removed = await send(`/api/trainer/clients/${created.id}`, {
    method: "DELETE",
    cookie: trainerCookie,
  });
  assert.equal(removed.status, 204);
  const count = (slotId: string) =>
    (database.prepare("SELECT COUNT(*) AS n FROM appointments WHERE slot_id = ?").get(slotId) as { n: number }).n;
  assert.equal(count(futureSlot), 0);
  assert.equal(count(pastSlot), 1);
});
