import assert from "node:assert/strict";
import { test } from "node:test";
import { readFlashToast, withoutFlashToast } from "../../client/src/flashToast.ts";

test("το μήνυμα αφαιρείται μία φορά χωρίς να χαθεί η υπόλοιπη κατάσταση πλοήγησης", () => {
  const state = { toast: "Ο κωδικός άλλαξε", from: "/change-password" };
  assert.equal(readFlashToast(state), "Ο κωδικός άλλαξε");
  const remaining = withoutFlashToast(state);
  assert.deepEqual(remaining, { from: "/change-password" });
  assert.equal(readFlashToast(remaining), "");
  assert.equal(withoutFlashToast(remaining), remaining);
  assert.equal(state.toast, "Ο κωδικός άλλαξε");
});

test("άσχετη ή μη έγκυρη κατάσταση πλοήγησης δεν αλλάζει", () => {
  for (const state of [null, undefined, "text", [], { toast: 123 }, { other: true }]) {
    assert.equal(readFlashToast(state), "");
    assert.equal(withoutFlashToast(state), state);
  }
});
