import { randomInt } from "node:crypto";

// Χωρίς 0/o, 1/l/i ώστε ο κωδικός να διαβάζεται και να πληκτρολογείται εύκολα (και από παιδί).
export const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const TEMPORARY_PASSWORD_LENGTH = 12;

export function createTemporaryPassword(): string {
  let password = "";
  for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
    password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return password;
}
