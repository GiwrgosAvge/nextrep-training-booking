import { existsSync } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface, emitKeypressEvents } from "node:readline";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const serverDirectory = path.resolve(import.meta.dirname, "..");
config({ path: path.join(serverDirectory, ".env") });

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(serverDirectory, process.env.DATABASE_PATH)
  : path.join(serverDirectory, "data", "training-booking.sqlite");

function ask(question) {
  return new Promise((resolve) => {
    const readline = createInterface({ input: stdin, output: stdout });
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

function askSecret(prompt) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Τρέξε την επαναφορά σε κανονικό, διαδραστικό terminal.");
  }

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();

    let value = "";
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("keypress", handleKeypress);
      stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const handleKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        finish(new Error("Η επαναφορά ακυρώθηκε."));
      } else if (key?.name === "return" || key?.name === "enter") {
        finish();
      } else if (key?.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
      } else if (character && !key?.ctrl && !key?.meta) {
        value += character;
      }
    };

    emitKeypressEvents(stdin);
    stdin.on("keypress", handleKeypress);
  });
}

async function main() {
  if (!existsSync(databasePath)) {
    throw new Error(`Δεν βρέθηκε η υπάρχουσα βάση δεδομένων: ${databasePath}`);
  }

  const database = new Database(databasePath);
  try {
    const trainers = database
      .prepare("SELECT id, username FROM users WHERE role = ? AND is_active = 1")
      .all("trainer");
    if (trainers.length === 0) {
      throw new Error("Δεν βρέθηκε ενεργός λογαριασμός προπονητή στη βάση.");
    }

    let trainer;
    if (trainers.length === 1) {
      trainer = trainers[0];
      stdout.write(`Λογαριασμός προπονητή: ${trainer.username}\n`);
    } else {
      stdout.write(`Ενεργοί λογαριασμοί προπονητή: ${trainers.map(({ username }) => username).join(", ")}\n`);
      const username = (await ask("Ποιον λογαριασμό θέλεις να επαναφέρεις; ")).trim();
      trainer = trainers.find(
        (candidate) => candidate.username.toLowerCase() === username.toLowerCase(),
      );
      if (!trainer) {
        throw new Error("Δεν βρέθηκε αυτός ο ενεργός λογαριασμός προπονητή.");
      }
    }

    const confirmation = await ask(
      `Για επιβεβαίωση, πληκτρολόγησε το username "${trainer.username}": `,
    );
    if (confirmation.trim().toLowerCase() !== trainer.username.toLowerCase()) {
      throw new Error("Το username δεν ταιριάζει. Δεν έγινε καμία αλλαγή.");
    }

    const password = await askSecret("Νέος κωδικός (δεν θα εμφανίζεται): ");
    if (password.length < 12 || password.length > 128) {
      throw new Error("Ο κωδικός πρέπει να έχει 12 έως 128 χαρακτήρες.");
    }
    const confirmationPassword = await askSecret("Πληκτρολόγησε ξανά τον νέο κωδικό: ");
    if (password !== confirmationPassword) {
      throw new Error("Οι κωδικοί δεν ταιριάζουν. Δεν έγινε καμία αλλαγή.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const updatePassword = database.transaction(() => {
      const result = database
        .prepare(
          `UPDATE users
           SET password_hash = ?, must_change_password = 0
           WHERE id = ? AND role = 'trainer' AND is_active = 1`,
        )
        .run(passwordHash, trainer.id);
      if (result.changes !== 1) {
        throw new Error("Ο λογαριασμός προπονητή δεν είναι πλέον ενεργός.");
      }

      const sessions = database
        .prepare("SELECT sid, session_data FROM sessions")
        .all();
      const deleteSession = database.prepare("DELETE FROM sessions WHERE sid = ?");
      let revokedSessions = 0;
      for (const session of sessions) {
        let data;
        try {
          data = JSON.parse(session.session_data);
        } catch (error) {
          throw new Error("Δεν ήταν δυνατή η ανάγνωση των ενεργών συνεδριών.", {
            cause: error,
          });
        }
        if (data?.user?.id === trainer.id) {
          revokedSessions += deleteSession.run(session.sid).changes;
        }
      }
      return revokedSessions;
    });

    const revokedSessions = updatePassword();
    stdout.write(
      `Ο κωδικός του/της ${trainer.username} άλλαξε. Ακυρώθηκαν ${revokedSessions} ενεργές συνεδρίες.\n`,
    );
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Η επαναφορά δεν ολοκληρώθηκε.");
  process.exitCode = 1;
});
