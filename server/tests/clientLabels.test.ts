import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeAccountsLabel,
  compactAppointmentLabel,
  deleteClientWarning,
  matchesSearch,
  relativeAppointmentLabel,
  shortAppointmentDate,
  upcomingAppointmentsCount,
} from "../../client/src/appointmentTime.ts";

test("η συμπαγής γραμμή «Αργότερα» δείχνει ημέρα και σύντομη ημερομηνία χωρίς επανάληψη", () => {
  const now = Date.parse("2026-10-27T10:00:00Z");
  assert.equal(compactAppointmentLabel("2026-10-28T16:30:00Z", now), "Αύριο στις 18:30");
  assert.equal(compactAppointmentLabel("2026-10-29T17:00:00Z", now), "Πέμπτη στις 19:00");
  assert.equal(shortAppointmentDate("2026-10-29T17:00:00Z", now), "29 Οκτωβρίου");
  assert.match(shortAppointmentDate("2027-01-05T17:00:00Z", now), /2027/);
});

test("η σχετική ημερομηνία ραντεβού χρησιμοποιεί ώρα Ελλάδας και 24ωρη μορφή", () => {
  // 22:30 UTC = 00:30 της επόμενης μέρας στην Ελλάδα (χειμώνας).
  const now = Date.parse("2027-01-10T22:30:00Z");
  assert.equal(relativeAppointmentLabel("2027-01-11T19:00:00Z", now), "Σήμερα στις 21:00");
  assert.equal(relativeAppointmentLabel("2027-01-12T19:00:00Z", now), "Αύριο στις 21:00");
  assert.match(relativeAppointmentLabel("2027-01-15T19:00:00Z", now), /^Παρασκευή 15 Ιανουαρίου στις 21:00$/);
  // Στην αλλαγή ώρας (Κυριακή 28/3/2027) το «αύριο» μένει σωστό.
  const beforeShift = Date.parse("2027-03-27T10:00:00Z");
  assert.equal(relativeAppointmentLabel("2027-03-28T18:00:00Z", beforeShift), "Αύριο στις 21:00");
});

test("οι πληθυντικοί των λογαριασμών και ραντεβού είναι σωστοί", () => {
  assert.equal(activeAccountsLabel(1), "1 ενεργός λογαριασμός");
  assert.equal(activeAccountsLabel(22), "22 ενεργοί λογαριασμοί");
  assert.equal(upcomingAppointmentsCount(1), "1 επόμενο ραντεβού");
  assert.equal(upcomingAppointmentsCount(3), "3 επόμενα ραντεβού");
});

test("το μήνυμα διαγραφής αναφέρει τα μελλοντικά ραντεβού", () => {
  assert.equal(
    deleteClientWarning("Νίκος", 3),
    "Θα διαγραφεί ο λογαριασμός του Νίκος και θα ακυρωθούν τα 3 μελλοντικά του ραντεβού. Δεν μπορεί να αναιρεθεί.",
  );
  assert.match(deleteClientWarning("nikos", 1), /θα ακυρωθεί το 1 μελλοντικό/);
  assert.equal(
    deleteClientWarning("nikos", 0),
    "Θα διαγραφεί ο λογαριασμός του nikos. Δεν μπορεί να αναιρεθεί.",
  );
});

test("η αναζήτηση αγνοεί κεφαλαία και κενά", () => {
  assert.equal(matchesSearch("Maria.K", "  maria "), true);
  assert.equal(matchesSearch("Maria.K", "nikos"), false);
});
