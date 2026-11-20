import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "better-sqlite3";
import { rateLimit } from "express-rate-limit";
import express, { type Request } from "express";
import { requireRole } from "./authorization.js";
import { getLocalDay, getLocalTime, getLocalToday, getLocalWeekday } from "./localDay.js";

interface AvailableSlot {
  id: string;
  startsAt: string;
  localDay: string;
  localTime: string;
  weekday: string;
}

interface BookedDay {
  localDay: string;
  localTime: string;
  weekday: string;
}

interface AiSuggestion {
  reply: string;
  slotId: string | null;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getMessage(request: Request): string {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null || !("message" in body)) {
    throw new ApiError(400, "Γράψε τι ώρα προτιμάς.");
  }

  const message = body.message;
  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > 200
  ) {
    throw new ApiError(400, "Το μήνυμα πρέπει να έχει 1 έως 200 χαρακτήρες.");
  }
  return message.trim();
}

function isSuggestion(value: unknown): value is AiSuggestion {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const suggestion = value as Record<string, unknown>;
  return (
    typeof suggestion.reply === "string" &&
    suggestion.reply.length > 0 &&
    suggestion.reply.length <= 500 &&
    (typeof suggestion.slotId === "string" || suggestion.slotId === null)
  );
}

function getBookableContext(
  database: Database,
  clientId: string,
): { slots: AvailableSlot[]; bookedDays: BookedDay[] } {
  const bookedAppointments = database
    .prepare(
      `SELECT a.local_day AS localDay, s.starts_at AS startsAt
       FROM appointments a JOIN slots s ON s.id = a.slot_id
       WHERE a.client_id = ? AND s.starts_at > ?
       ORDER BY s.starts_at`,
    )
    .all(clientId, new Date().toISOString()) as { localDay: string; startsAt: string }[];
  const bookedDayKeys = new Set(bookedAppointments.map((item) => item.localDay));

  const freeSlots = database
    .prepare(
      `SELECT s.id, s.starts_at AS startsAt
       FROM slots s
       LEFT JOIN appointments a ON a.slot_id = s.id
       WHERE a.id IS NULL AND s.starts_at > ?
       ORDER BY s.starts_at`,
    )
    .all(new Date().toISOString()) as { id: string; startsAt: string }[];

  // Το μοντέλο βλέπει μόνο ώρες που ο συγκεκριμένος ασκούμενος μπορεί πράγματι να κλείσει.
  const slots = freeSlots
    .map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt,
      localDay: getLocalDay(slot.startsAt),
      localTime: getLocalTime(slot.startsAt),
      weekday: getLocalWeekday(slot.startsAt),
    }))
    .filter((slot) => !bookedDayKeys.has(slot.localDay));
  const bookedDays = bookedAppointments.map((item) => ({
    localDay: item.localDay,
    localTime: getLocalTime(item.startsAt),
    weekday: getLocalWeekday(item.startsAt),
  }));
  return { slots, bookedDays };
}

function parseToolInput(value: unknown): AiSuggestion {
  if (!isSuggestion(value)) {
    throw new ApiError(502, "Ο βοηθός επέστρεψε απάντηση σε μη αναμενόμενη μορφή.");
  }
  return value;
}

export function createAiRouter(
  database: Database,
  anthropic: Anthropic | null,
  model: string,
): express.Router {
  const router = express.Router();
  const suggestionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: "Έκανες πολλές ερωτήσεις σε λίγο χρόνο. Δοκίμασε ξανά σε ένα λεπτό.",
      });
    },
  });

  router.post(
    "/slot-suggestion",
    requireRole(database, "client"),
    suggestionLimiter,
    async (request, response, next) => {
      if (!anthropic) {
        response.status(503).json({
          error: "Ο βοηθός δεν είναι διαθέσιμος. Ο server χρειάζεται ρύθμιση AI.",
        });
        return;
      }

      try {
        const message = getMessage(request);
        const user = request.session.user!;
        const { slots, bookedDays } = getBookableContext(database, user.id);
        const tool = {
          name: "suggest_available_slot",
          description:
            "Return a short Greek reply and one exact available slot ID, or null when none fits.",
          input_schema: {
            type: "object" as const,
            properties: {
              reply: { type: "string" as const },
              slotId: { type: ["string", "null"] as const },
            },
            required: ["reply", "slotId"],
            additionalProperties: false,
          },
        };

        const result = await anthropic.messages.create({
          model,
          max_tokens: 220,
          system: [
            "Είσαι βοηθός κρατήσεων για προσωπικό προπονητή. Απάντησε στα ελληνικά, σύντομα και ευγενικά.",
            "Ο ασκούμενος είναι ήδη συνδεδεμένος. Μην ζητήσεις το όνομά του ή άλλα προσωπικά στοιχεία (τηλέφωνο, email, διεύθυνση, πληροφορίες υγείας) και μην τα επαναλάβεις στην απάντηση, ακόμη κι αν τα γράψει ο ίδιος.",
            "Απάντα πάντα σύντομα (1-2 προτάσεις) και φιλικά, στα ελληνικά. Μείνε αποκλειστικά στο θέμα των ραντεβού προπόνησης: αν η ερώτηση δεν αφορά ραντεβού, πες ευγενικά ότι βοηθάς μόνο με την εύρεση ώρας και επέστρεψε slotId null.",
            "Μόνο πρότεινε ώρα. Δεν μπορείς να κάνεις, αλλάξεις ή ακυρώσεις κράτηση.",
            "Διάλεξε slotId μόνο από τη λίστα διαθέσιμων ωρών που παρέχει ο server. Αν καμία δεν ταιριάζει, επέστρεψε slotId null.",
            "Οι ώρες localDay/localTime είναι ώρα Ελλάδας. Ο ασκούμενος μπορεί να έχει το πολύ ένα ραντεβού ανά μέρα.",
            "Το bookedDays έχει τις μέρες που ο ασκούμενος έχει ήδη ραντεβού. Αν ζητήσει ώρα σε τέτοια μέρα, επέστρεψε slotId null, πες φιλικά ότι έχει ήδη κλείσει εκείνη τη μέρα (με την ώρα του) και πρότεινε να αλλάξει ώρα στο υπάρχον ραντεβού ή να διαλέξει άλλη μέρα.",
            "Το today έχει τη σημερινή μέρα (localDay, weekday) και το αύριο (tomorrowLocalDay) στην ώρα Ελλάδας. Χρησιμοποίησέ το για «αύριο», «αυτή την εβδομάδα», «Σαββατοκύριακο» και «το συντομότερο» (η πρώτη ελεύθερη ώρα της λίστας).",
            "Αν ο χρήστης ζητήσει αλλαγή ραντεβού, εξήγησε ότι πρέπει να επιλέξει διαθέσιμη πρόταση και να την επιβεβαιώσει.",
          ].join("\n"),
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                request: message,
                today: getLocalToday(new Date()),
                bookedDays,
                availableSlots: slots,
              }),
            },
          ],
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
        });

        const toolResult = result.content.find((item) => item.type === "tool_use");
        if (!toolResult) {
          throw new ApiError(502, "Ο βοηθός δεν επέστρεψε πρόταση.");
        }
        const suggestion = parseToolInput(toolResult.input);
        if (
          suggestion.slotId !== null &&
          !slots.some((slot) => slot.id === suggestion.slotId)
        ) {
          throw new ApiError(502, "Ο βοηθός πρότεινε ώρα που δεν είναι πλέον διαθέσιμη.");
        }

        response.json(suggestion);
      } catch (error) {
        if (error instanceof ApiError) {
          next(error);
          return;
        }
        console.error("AI suggestion request failed:", error);
        response.status(502).json({
          error: "Δεν ήταν δυνατή η λήψη πρότασης από τον βοηθό. Δοκίμασε ξανά.",
        });
      }
    },
  );

  return router;
}

export function handleAiApiError(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}
