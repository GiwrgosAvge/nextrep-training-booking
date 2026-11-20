import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { ensureInitialTrainer } from "./auth.js";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";

const port = Number(process.env.PORT ?? "3000");
const sessionSecret = process.env.SESSION_SECRET;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Η μεταβλητή PORT πρέπει να είναι έγκυρη θύρα.");
}
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Όρισε SESSION_SECRET με τουλάχιστον 32 χαρακτήρες στο .env.");
}

const database = createDatabase(
  process.env.DATABASE_PATH,
  process.env.LEGACY_SLOTS_PATH,
);
await ensureInitialTrainer(
  database,
  process.env.TRAINER_USERNAME,
  process.env.TRAINER_PASSWORD,
);
const aiAssistantEnabled = process.env.AI_ASSISTANT_ENABLED === "true";
const anthropic = aiAssistantEnabled && process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const aiModel = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const app = createApp(database, sessionSecret, anthropic, aiModel, aiAssistantEnabled);

app.listen(port, "127.0.0.1", () => {
  console.log(`Ο server λειτουργεί στο http://127.0.0.1:${port}`);
});
