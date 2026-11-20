// Γεμίζει μια ΚΕΝΗ τοπική βάση με demo δεδομένα, ώστε όποιος δοκιμάζει το project
// να δει αμέσως γεμάτη εφαρμογή. Δεν αγγίζει ποτέ βάση που έχει ήδη λογαριασμούς.
import { randomUUID } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { createDatabase } from "../src/database.js";
import { getLocalDay } from "../src/localDay.js";

const serverDirectory = path.resolve(import.meta.dirname, "..");
config({ path: path.join(serverDirectory, ".env") });

// Οι κωδικοί είναι δημόσιοι (γράφονται και στο README): μόνο για τοπική δοκιμή.
const DEMO_TRAINER = { username: "demo.trainer", password: "NextRep-Demo-2026" };
const DEMO_CLIENT_PASSWORD = "NextRep-Client-2026";
const DEMO_NEW_CLIENT = { username: "giorgos.new", password: "NextRep-Welcome-1" };

const activeClients = ["maria.demo", "nikos.demo", "eleni.demo"];
const inactiveClient = "kostas.demo";

const athensParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Athens",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function athensOffsetMs(instant: number): number {
  const parts = Object.fromEntries(
    athensParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

// Ώρα Ελλάδας → ISO σε UTC. Η μετατόπιση υπολογίζεται από την Intl, άρα αντέχει στην αλλαγή ώρας.
function athensTimeToIso(localDay: string, time: string): string {
  const [year, month, day] = localDay.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClock - athensOffsetMs(wallClock);
  instant = wallClock - athensOffsetMs(instant);
  return new Date(instant).toISOString();
}

function addDays(localDay: string, days: number): string {
  const date = new Date(`${localDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hoursFor(localDay: string): string[] {
  const weekday = new Date(`${localDay}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return [];
  if (weekday === 6) return ["09:00", "10:00", "11:00"];
  return ["08:00", "09:00", "10:00", "18:00", "19:00", "20:00"];
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Το demo seed δεν τρέχει σε production.");
  }

  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(serverDirectory, process.env.DATABASE_PATH)
    : path.join(serverDirectory, "data", "training-booking.sqlite");
  const database = createDatabase(databasePath);

  try {
    const { total } = database.prepare("SELECT COUNT(*) AS total FROM users").get() as {
      total: number;
    };
    if (total > 0) {
      throw new Error(
        `Η βάση ${databasePath} έχει ήδη λογαριασμούς, οπότε δεν την αλλάζω. ` +
          "Για demo όρισε άλλο DATABASE_PATH στο .env ή σβήσε τη βάση αν δεν τη χρειάζεσαι.",
      );
    }

    const trainerHash = await bcrypt.hash(DEMO_TRAINER.password, 12);
    const clientHash = await bcrypt.hash(DEMO_CLIENT_PASSWORD, 12);
    const newClientHash = await bcrypt.hash(DEMO_NEW_CLIENT.password, 12);

    const now = Date.now();
    const today = getLocalDay(new Date(now).toISOString());

    const insertUser = database.prepare(
      `INSERT INTO users (id, username, password_hash, role, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertSlot = database.prepare("INSERT INTO slots (id, starts_at) VALUES (?, ?)");
    const insertAppointment = database.prepare(
      `INSERT INTO appointments (id, slot_id, client_id, local_day) VALUES (?, ?, ?, ?)`,
    );

    let slotCount = 0;
    let appointmentCount = 0;

    const seed = database.transaction(() => {
      insertUser.run(randomUUID(), DEMO_TRAINER.username, trainerHash, "trainer", 1, 0);

      const clientIds = activeClients.map((username) => {
        const id = randomUUID();
        insertUser.run(id, username, clientHash, "client", 1, 0);
        return id;
      });
      insertUser.run(randomUUID(), inactiveClient, clientHash, "client", 0, 0);
      insertUser.run(randomUUID(), DEMO_NEW_CLIENT.username, newClientHash, "client", 1, 1);

      const book = (startsAt: string, clientId: string) => {
        const slotId = randomUUID();
        insertSlot.run(slotId, startsAt);
        insertAppointment.run(randomUUID(), slotId, clientId, getLocalDay(startsAt));
        slotCount += 1;
        appointmentCount += 1;
      };

      // Λίγα παλιά ραντεβού, για να φαίνεται και το ιστορικό.
      book(athensTimeToIso(addDays(today, -1), "18:00"), clientIds[0]);
      book(athensTimeToIso(addDays(today, -3), "09:00"), clientIds[1]);
      book(athensTimeToIso(addDays(today, -6), "19:00"), clientIds[2]);

      // Δύο εβδομάδες ώρες· σε κάθε μέρα κλείνουν μία ή δύο, με το πολύ ένα ραντεβού ανά ασκούμενο.
      for (let offset = 0; offset < 14; offset += 1) {
        const localDay = addDays(today, offset);
        const futureHours = hoursFor(localDay)
          .map((time) => athensTimeToIso(localDay, time))
          .filter((startsAt) => Date.parse(startsAt) > now + 30 * 60_000);

        futureHours.forEach((startsAt, index) => {
          const bookFor =
            index === 0 && offset % 2 === 0
              ? clientIds[offset % clientIds.length]
              : index === futureHours.length - 2
                ? clientIds[(offset + 1) % clientIds.length]
                : null;
          if (bookFor) {
            book(startsAt, bookFor);
          } else {
            insertSlot.run(randomUUID(), startsAt);
            slotCount += 1;
          }
        });
      }
    });
    seed();

    console.log(`Έτοιμο: ${slotCount} ώρες και ${appointmentCount} ραντεβού στη ${databasePath}`);
    console.log("");
    console.log("Demo λογαριασμοί (μόνο για τοπική δοκιμή):");
    console.log(`  Προπονητής:   ${DEMO_TRAINER.username} / ${DEMO_TRAINER.password}`);
    console.log(`  Ασκούμενοι:   ${activeClients.join(", ")} / ${DEMO_CLIENT_PASSWORD}`);
    console.log(`  Νέος (αλλάζει κωδικό στην πρώτη σύνδεση): ${DEMO_NEW_CLIENT.username} / ${DEMO_NEW_CLIENT.password}`);
    console.log(`  Απενεργοποιημένος: ${inactiveClient}`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
