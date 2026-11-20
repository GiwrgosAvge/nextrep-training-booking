import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { ensureInitialTrainer } from "../src/auth.js";
import { createDatabase } from "../src/database.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/passwordPolicy.js";
import {
  MAX_PASSWORD_LENGTH as CLIENT_MAX,
  MIN_PASSWORD_LENGTH as CLIENT_MIN,
  checkNewPassword,
  getPasswordStrength,
  isPasswordAcceptable,
} from "../../client/src/passwordPolicy.js";

const trainerUsername = "trainer.password";
const trainerPassword = "trainer-password-test-1";
const state = { baseUrl: "", directory: "", close: async () => {} };

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

before(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "training-booking-password-test-"));
  const legacySlotsPath = path.join(state.directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  const database = createDatabase(path.join(state.directory, "test.sqlite"), legacySlotsPath);
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
});

after(async () => {
  await state.close();
  await rm(state.directory, { recursive: true, force: true });
});

test("client and server share the same password limits", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(CLIENT_MIN, MIN_PASSWORD_LENGTH);
  assert.equal(CLIENT_MAX, MAX_PASSWORD_LENGTH);
  assert.ok(MAX_PASSWORD_LENGTH >= 64);
});

test("client password checks and strength", () => {
  const weak = checkNewPassword("12345678", "maria", "old-secret-1");
  assert.equal(weak.notCommon, false);
  assert.equal(isPasswordAcceptable(weak), false);
  const good = checkNewPassword("blue-tiger-jumps", "maria", "old-secret-1");
  assert.equal(isPasswordAcceptable(good), true);
  assert.equal(getPasswordStrength("blue-tiger-jumps", true), "strong");
  assert.equal(getPasswordStrength("abcdefgh", true), "medium");
  assert.equal(getPasswordStrength("abc", false), "weak");
});

test("password change: validation, mandatory first change and success", async () => {
  const trainer = await send("/api/auth/login", {
    method: "POST",
    body: { username: trainerUsername, password: trainerPassword },
  });
  const created = await send("/api/trainer/clients", {
    method: "POST",
    cookie: trainer.cookie!,
    body: { username: "first.login" },
  });
  assert.equal(created.status, 201);
  const temporary = created.data.temporaryPassword as string;
  const login = await send("/api/auth/login", {
    method: "POST",
    body: { username: "first.login", password: temporary },
  });
  const cookie = login.cookie!;

  const change = (body: unknown) =>
    send("/api/auth/change-password", { method: "POST", cookie, body });
  const stillBlocked = async () => {
    const blocked = await send("/api/client/slots", { cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, "PASSWORD_CHANGE_REQUIRED");
  };

  await stillBlocked();

  const wrongCurrent = await change({ password: "not-the-password", newPassword: "fresh-pass-99" });
  assert.equal(wrongCurrent.status, 400);
  assert.match(String(wrongCurrent.data.error), /τρέχων κωδικός/);

  const tooShort = await change({ password: temporary, newPassword: "a".repeat(MIN_PASSWORD_LENGTH - 1) });
  assert.equal(tooShort.status, 400);

  const sameAsOld = await change({ password: temporary, newPassword: temporary });
  assert.equal(sameAsOld.status, 400);

  const common = await change({ password: temporary, newPassword: "12345678" });
  assert.equal(common.status, 400);

  const sameAsUsername = await change({ password: temporary, newPassword: "First.Login" });
  assert.equal(sameAsUsername.status, 400);

  const tooLong = await change({ password: temporary, newPassword: "a".repeat(MAX_PASSWORD_LENGTH + 1) });
  assert.equal(tooLong.status, 400);

  // Καμία αποτυχημένη προσπάθεια δεν άνοιξε την πρόσβαση.
  await stillBlocked();

  const accepted = await change({ password: temporary, newPassword: "x".repeat(MIN_PASSWORD_LENGTH) + "-ok" });
  assert.equal(accepted.status, 200);
  assert.equal((await send("/api/client/slots", { cookie })).status, 200);

  const oldLogin = await send("/api/auth/login", {
    method: "POST",
    body: { username: "first.login", password: temporary },
  });
  assert.equal(oldLogin.status, 401);
});
