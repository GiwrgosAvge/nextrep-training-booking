import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import { createAuthRouter } from "./auth.js";
import { createAiRouter, handleAiApiError } from "./aiRoutes.js";
import { createBookingRouter, handleApiError } from "./bookingRoutes.js";
import { createClientRouter, handleClientApiError } from "./clientRoutes.js";
import type { Database } from "better-sqlite3";
import { SqliteSessionStore } from "./sessionStore.js";

export function createApp(
  database: Database,
  sessionSecret: string,
  anthropic: Anthropic | null = null,
  aiModel = "claude-haiku-4-5",
  aiAssistantEnabled = false,
): express.Express {
  const app = express();
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(
    session({
      name: "training.sid",
      secret: sessionSecret,
      store: new SqliteSessionStore(database),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );

  app.use("/api/auth", createAuthRouter(database));
  app.use("/api", createBookingRouter(database));
  app.use(
    "/api/ai",
    createAiRouter(database, aiAssistantEnabled ? anthropic : null, aiModel),
  );
  app.use("/api/trainer", createClientRouter(database));
  app.use((_request, response) => {
    response.status(404).json({ error: "Το endpoint δεν βρέθηκε." });
  });

  const handleError: ErrorRequestHandler = (error: unknown, request, response, next) => {
    if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
      response.status(400).json({ error: "Το σώμα του αιτήματος δεν είναι έγκυρο JSON." });
      return;
    }

    handleAiApiError(error, request, response, (aiError) => {
      handleClientApiError(aiError, request, response, (clientError) => {
        handleApiError(clientError, request, response, (unhandledError) => {
          if (unhandledError) {
            console.error(unhandledError);
            response
              .status(500)
              .json({ error: "Παρουσιάστηκε σφάλμα στον server. Δοκίμασε ξανά." });
          } else {
            next();
          }
        });
      });
    });
  };
  app.use(handleError);
  return app;
}
