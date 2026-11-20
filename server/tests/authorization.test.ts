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

const trainerUsername = "trainer.test";
const trainerPassword = "trainer-test-password";
const newClientPassword = "new-client-password-123";
const baseUrl = { value: "" };
const databaseState: { close?: () => Promise<void>; directory?: string } = {};

interface ApiResponse {
  response: Response
  data: unknown
  cookie: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function send(
  route: string,
  options: {
    method?: string
    body?: unknown
    cookie?: string
  } = {},
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl.value}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const data: unknown = response.status === 204 ? null : await response.json();
  const setCookie = response.headers.get("set-cookie");
  return {
    response,
    data,
    cookie: setCookie ? setCookie.split(";")[0] : options.cookie ?? null,
  };
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${description} must be a JSON object`);
  return value;
}

async function login(username: string, password: string): Promise<string> {
  const result = await send("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie, "login must issue a session cookie");
  return result.cookie;
}

async function createClient(trainerCookie: string, username: string): Promise<string> {
  const result = await send("/api/trainer/clients", {
    method: "POST",
    cookie: trainerCookie,
    body: { username },
  });
  assert.equal(result.response.status, 201);
  const responseData = requireRecord(result.data, "client creation response");
  assert.equal(typeof responseData.temporaryPassword, "string");
  const clientCookie = await login(username, responseData.temporaryPassword as string);
  const passwordChange = await send("/api/auth/change-password", {
    method: "POST",
    cookie: clientCookie,
    body: { password: responseData.temporaryPassword, newPassword: newClientPassword },
  });
  assert.equal(passwordChange.response.status, 200);
  return clientCookie;
}

async function createSlot(trainerCookie: string, startsAt: string): Promise<string> {
  const result = await send("/api/trainer/slots", {
    method: "POST",
    cookie: trainerCookie,
    body: { startsAt },
  });
  assert.equal(result.response.status, 201);
  const responseData = requireRecord(result.data, "slot creation response");
  const slot = requireRecord(responseData.slot, "created slot");
  assert.equal(typeof slot.id, "string");
  return slot.id as string;
}

before(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "training-booking-auth-test-"));
  databaseState.directory = directory;
  const legacySlotsPath = path.join(directory, "legacy.json");
  await writeFile(legacySlotsPath, "[]", "utf8");
  const database = createDatabase(path.join(directory, "test.sqlite"), legacySlotsPath);
  databaseState.close = async () => {
    database.close();
  };
  await ensureInitialTrainer(database, trainerUsername, trainerPassword);

  const app = createApp(
    database,
    "test-session-secret-with-more-than-thirty-two-characters",
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl.value = `http://127.0.0.1:${address.port}`;
  databaseState.close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    database.close();
  };
});

after(async () => {
  await databaseState.close?.();
  if (databaseState.directory) {
    await rm(databaseState.directory, { recursive: true, force: true });
  }
});

test("enforces role boundaries, appointment ownership, and atomic booking", async () => {
  const unauthenticated = await send("/api/trainer/slots");
  assert.equal(unauthenticated.response.status, 401);

  const trainerCookie = await login(trainerUsername, trainerPassword);
  const clientACookie = await createClient(trainerCookie, "client.alpha");
  const clientBCookie = await createClient(trainerCookie, "client.bravo");

  const slotA = await createSlot(
    trainerCookie,
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );
  const slotB = await createSlot(
    trainerCookie,
    new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  );

  for (const route of ["/api/trainer/slots", "/api/trainer/clients"]) {
    const forbidden = await send(route, { cookie: clientACookie });
    assert.equal(forbidden.response.status, 403, `${route} must reject a client`);
  }

  const bookingA = await send("/api/client/appointments", {
    method: "POST",
    cookie: clientACookie,
    body: { slotId: slotA },
  });
  assert.equal(bookingA.response.status, 201);
  const bookingData = requireRecord(bookingA.data, "booking response");
  const appointment = requireRecord(bookingData.appointment, "appointment");
  assert.equal(typeof appointment.id, "string");
  const appointmentId = appointment.id as string;

  const clientAAppointments = await send("/api/client/appointments", {
    cookie: clientACookie,
  });
  assert.equal(clientAAppointments.response.status, 200);
  const clientAData = requireRecord(clientAAppointments.data, "client appointment list");
  assert.equal(Array.isArray(clientAData.appointments), true);
  assert.equal((clientAData.appointments as unknown[]).length, 1);

  const clientBAppointments = await send("/api/client/appointments", {
    cookie: clientBCookie,
  });
  const clientBData = requireRecord(clientBAppointments.data, "second client appointment list");
  assert.deepEqual(clientBData.appointments, []);

  const forbiddenMove = await send(`/api/client/appointments/${appointmentId}`, {
    method: "PATCH",
    cookie: clientBCookie,
    body: { slotId: slotB },
  });
  assert.equal(forbiddenMove.response.status, 404);

  const forbiddenCancel = await send(`/api/client/appointments/${appointmentId}`, {
    method: "DELETE",
    cookie: clientBCookie,
  });
  assert.equal(forbiddenCancel.response.status, 404);

  const concurrentBookings = await Promise.all(
    [clientACookie, clientBCookie].map((cookie) =>
      send("/api/client/appointments", {
        method: "POST",
        cookie,
        body: { slotId: slotB },
      }),
    ),
  );
  assert.deepEqual(
    concurrentBookings.map((result) => result.response.status).sort(),
    [201, 409],
  );

  const trainerSchedule = await send("/api/trainer/slots", { cookie: trainerCookie });
  assert.equal(trainerSchedule.response.status, 200);
  const scheduleData = requireRecord(trainerSchedule.data, "trainer schedule");
  assert.ok(Array.isArray(scheduleData.slots));
  const bookedSlots = (scheduleData.slots as unknown[]).filter(
    (slot) => isRecord(slot) && slot.appointmentId !== null,
  );
  assert.equal(bookedSlots.length, 2);
  assert.ok(
    bookedSlots.some((slot) => isRecord(slot) && slot.clientUsername === "client.alpha"),
  );
});
