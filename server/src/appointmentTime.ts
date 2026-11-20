// Ένα ραντεβού «έχει περάσει» όταν η ώρα έναρξής του είναι ίση ή πριν από τώρα.
// Οι ώρες αποθηκεύονται ως ISO σε UTC, δηλαδή ως απόλυτες χρονικές στιγμές, άρα η
// σύγκριση με το Date.now() είναι σωστή και στην Ελλάδα, χωρίς μετατροπή ζώνης ώρας.
export function hasStarted(startsAt: string, now: number = Date.now()): boolean {
  const startTime = Date.parse(startsAt);
  return !Number.isFinite(startTime) || startTime <= now;
}
