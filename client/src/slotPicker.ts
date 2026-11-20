export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => pad(hour))
export const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, step) => pad(step * 5))

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toTimeKey(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toDate(day: string, time: string): Date {
  return new Date(`${day}T${time}`)
}

export type PickedTimeProblem = 'incomplete' | 'past' | 'taken' | 'selected'

export const pickedTimeMessages: Record<PickedTimeProblem, string> = {
  incomplete: 'Διάλεξε και ώρα και λεπτά.',
  past: 'Αυτή η ώρα έχει ήδη περάσει.',
  taken: 'Υπάρχει ήδη διαθέσιμη ώρα εκείνη τη στιγμή.',
  selected: 'Έχεις ήδη επιλέξει αυτή την ώρα.',
}

// Ελέγχει την ώρα που διάλεξε ο προπονητής από τους επιλογείς ώρας/λεπτών.
export function checkPickedTime(
  day: string,
  hour: string,
  minute: string,
  now: number,
  takenTimes: ReadonlySet<string>,
  selectedTimes: readonly string[],
): { time: string; problem: null } | { time: null; problem: PickedTimeProblem } {
  if (hour === '' || minute === '') {
    return { time: null, problem: 'incomplete' }
  }
  const time = `${hour}:${minute}`
  if (toDate(day, time).getTime() <= now) {
    return { time: null, problem: 'past' }
  }
  if (takenTimes.has(time)) {
    return { time: null, problem: 'taken' }
  }
  if (selectedTimes.includes(time)) {
    return { time: null, problem: 'selected' }
  }
  return { time, problem: null }
}

export function addPickedTime(selected: readonly string[], time: string): string[] {
  return selected.includes(time) ? [...selected] : [...selected, time].sort()
}

export const addHoursLabel = (count: number) =>
  count === 1 ? 'Πρόσθεσε 1 ώρα' : `Πρόσθεσε ${count} ώρες`
