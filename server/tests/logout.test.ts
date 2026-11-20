import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";

const username = "logout.kid";
const password = "logout-kid-password";
const state = { baseUrl: "", directory: "", close: async () => {} };
let database: Database;

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-logout-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
  database
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, is_active) VALUES (?, ?, ?, 'client', 1)",
    )
    .run(randomUUID(), username, await bcrypt.hash(password, 4));
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
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("η έξοδος διαγράφει το session στον server και το παλιό cookie παύει να ισχύει", async () => {
  const login = await fetch(`${state.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const sessionsBefore = (database.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
  assert.equal(sessionsBefore, 1);

  const me = await fetch(`${state.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);

  const logout = await fetch(`${state.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0);

  // Ακόμη κι αν κάποιος κρατήσει το παλιό cookie, ο server δεν το δέχεται πια.
  const replay = await fetch(`${state.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { user: unknown }).user, null);
  const protectedRoute = await fetch(`${state.baseUrl}/api/client/appointments`, {
    headers: { Cookie: cookie },
  });
  assert.equal(protectedRoute.status, 401);
});
