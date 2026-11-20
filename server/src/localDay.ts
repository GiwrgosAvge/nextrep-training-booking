export const TRAINING_TIME_ZONE = "Europe/Athens";

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TRAINING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TRAINING_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getPart(parts: Intl.DateTimeFormatPart[], type: "year" | "month" | "day"): string {
  const part = parts.find((item) => item.type === type);
  if (!part) {
    throw new Error("Μη έγκυρη ημερομηνία.");
  }
  return part.value;
}

// Η Intl ξέρει τους κανόνες θερινής/χειμερινής ώρας, γι' αυτό δεν προσθέτουμε ποτέ ώρες με το χέρι.
export function getLocalDay(startsAt: string): string {
  const parts = dayFormatter.formatToParts(new Date(startsAt));
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(parts, "day")}`;
}

export function getLocalTime(startsAt: string): string {
  return timeFormatter.format(new Date(startsAt));
}

const weekdayFormatter = new Intl.DateTimeFormat("el-GR", {
  timeZone: TRAINING_TIME_ZONE,
  weekday: "long",
});

export function getLocalWeekday(startsAt: string): string {
  return weekdayFormatter.format(new Date(startsAt));
}

// Το «αύριο» υπολογίζεται πάνω στην ημερομηνία Ελλάδας (όχι +24 ώρες), ώστε να αντέχει στην αλλαγή ώρας.
export function getLocalToday(now: Date): { localDay: string; weekday: string; tomorrowLocalDay: string } {
  const localDay = getLocalDay(now.toISOString());
  const tomorrow = new Date(`${localDay}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    localDay,
    weekday: getLocalWeekday(now.toISOString()),
    tomorrowLocalDay: getLocalDay(tomorrow.toISOString()),
  };
}
