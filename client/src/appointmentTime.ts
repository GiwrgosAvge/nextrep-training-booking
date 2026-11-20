// Καθαρές βοηθητικές συναρτήσεις, χωρίς React, ώστε να ελέγχονται εύκολα με tests.

// Μια ώρα «έχει περάσει» όταν η έναρξή της είναι ίση ή πριν από τώρα. Οι ώρες είναι ISO σε UTC
// (απόλυτες χρονικές στιγμές), άρα η σύγκριση είναι σωστή και στην ώρα Ελλάδας.
export function isPastStart(startsAt: string, now: number): boolean {
  const startTime = Date.parse(startsAt)
  return !Number.isFinite(startTime) || startTime <= now
}

const athensDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const athensTimeFormat = new Intl.DateTimeFormat('el-GR', {
  timeZone: 'Europe/Athens',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// Ημερολογιακή ημέρα στην ώρα Ελλάδας (YYYY-MM-DD), όπως την υπολογίζει και ο server.
export const athensDay = (startsAt: string) => athensDayFormat.format(new Date(startsAt))
export const athensTime = (startsAt: string) => athensTimeFormat.format(new Date(startsAt))

const relativeDateFormat = new Intl.DateTimeFormat('el-GR', {
  timeZone: 'Europe/Athens',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

// Για «Σήμερα/Αύριο» λέμε «της προπόνησης του Αύριο…», για πιο μακρινές μέρες αποφεύγουμε την ασυμβίβαστη πτώση.
export function cancelQuestion(startsAt: string, now: number): string {
  const label = relativeAppointmentLabel(startsAt, now)
  const isNear = label.startsWith('Σήμερα') || label.startsWith('Αύριο')
  return isNear
    ? `Να ακυρωθεί η προπόνηση του ${label};`
    : `Να ακυρωθεί η προπόνηση: ${label};`
}

// «Σήμερα στις 21:00», «Αύριο στις 21:00» ή «Παρασκευή 30 Οκτωβρίου στις 21:00», πάντα με ώρα Ελλάδας.
export function relativeAppointmentLabel(startsAt: string, now: number): string {
  const today = athensDay(new Date(now).toISOString())
  // Το «αύριο» υπολογίζεται πάνω στην ημερομηνία (όχι +24 ώρες), ώστε να αντέχει στην αλλαγή ώρας.
  const tomorrowDate = new Date(`${today}T12:00:00Z`)
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
  const tomorrow = tomorrowDate.toISOString().slice(0, 10)
  const day = athensDay(startsAt)
  const time = athensTime(startsAt)
  if (day === today) {
    return `Σήμερα στις ${time}`
  }
  if (day === tomorrow) {
    return `Αύριο στις ${time}`
  }
  return `${relativeDateFormat.format(new Date(startsAt))} στις ${time}`
}

const weekdayFormat = new Intl.DateTimeFormat('el-GR', { timeZone: 'Europe/Athens', weekday: 'long' })
const dayMonthFormat = new Intl.DateTimeFormat('el-GR', {
  timeZone: 'Europe/Athens',
  day: 'numeric',
  month: 'long',
})
const dayMonthYearFormat = new Intl.DateTimeFormat('el-GR', {
  timeZone: 'Europe/Athens',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// Συμπαγής γραμμή για λίστες: «Σήμερα στις 19:00», «Αύριο στις 19:00» ή «Πέμπτη στις 19:00».
export function compactAppointmentLabel(startsAt: string, now: number): string {
  const label = relativeAppointmentLabel(startsAt, now)
  if (label.startsWith('Σήμερα') || label.startsWith('Αύριο')) {
    return label
  }
  return `${weekdayFormat.format(new Date(startsAt))} στις ${athensTime(startsAt)}`
}

// «29 Οκτωβρίου», με έτος μόνο αν δεν είναι η τρέχουσα χρονιά (ώρα Ελλάδας).
export function shortAppointmentDate(startsAt: string, now: number): string {
  const sameYear = athensDay(startsAt).slice(0, 4) === athensDay(new Date(now).toISOString()).slice(0, 4)
  return (sameYear ? dayMonthFormat : dayMonthYearFormat).format(new Date(startsAt))
}

// Ραντεβού του ίδιου ασκούμενου την ίδια μέρα, εκτός από αυτό που επεξεργαζόμαστε.
export function findSameDayAppointment<
  T extends { startsAt: string; clientId: string | null; appointmentId: string | null },
>(slots: readonly T[], clientId: string, startsAt: string, ignoreAppointmentId: string | null): T | undefined {
  const day = athensDay(startsAt)
  return slots.find(
    (slot) =>
      slot.appointmentId !== null &&
      slot.appointmentId !== ignoreAppointmentId &&
      slot.clientId === clientId &&
      athensDay(slot.startsAt) === day,
  )
}

export function partitionByTime<T extends { startsAt: string }>(
  items: readonly T[],
  now: number,
): { upcoming: T[]; past: T[] } {
  const byStart = (first: T, second: T) => Date.parse(first.startsAt) - Date.parse(second.startsAt)
  return {
    upcoming: items.filter((item) => !isPastStart(item.startsAt, now)).sort(byStart),
    past: items.filter((item) => isPastStart(item.startsAt, now)).sort(byStart).reverse(),
  }
}

export function pluralWord(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${pluralWord(count, one, many)}`
}

export const appointmentCount = (count: number) => pluralize(count, 'ραντεβού', 'ραντεβού')
export const freeHoursCount = (count: number) => pluralize(count, 'ελεύθερη ώρα', 'ελεύθερες ώρες')
export const freeBadgeLabel = (count: number) => pluralize(count, 'ελεύθερη', 'ελεύθερες')
export const upcomingAppointmentsCount = (count: number) =>
  pluralize(count, 'επόμενο ραντεβού', 'επόμενα ραντεβού')
export const activeAccountsLabel = (count: number) =>
  pluralize(count, 'ενεργός λογαριασμός', 'ενεργοί λογαριασμοί')

export function deleteClientWarning(name: string, upcomingCount: number): string {
  const cancelled =
    upcomingCount === 0
      ? ''
      : upcomingCount === 1
        ? ' και θα ακυρωθεί το 1 μελλοντικό του ραντεβού'
        : ` και θα ακυρωθούν τα ${upcomingCount} μελλοντικά του ραντεβού`
  return `Θα διαγραφεί ο λογαριασμός του ${name}${cancelled}. Δεν μπορεί να αναιρεθεί.`
}

export function matchesSearch(name: string, query: string): boolean {
  return name.toLocaleLowerCase('el-GR').includes(query.trim().toLocaleLowerCase('el-GR'))
}

export function getInitials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean)
  const letters =
    words.length > 1 ? [words[0], words[1]].map((word) => word[0]) : Array.from(words[0] ?? '?').slice(0, 2)
  return letters.join('').toLocaleUpperCase('el-GR')
}
