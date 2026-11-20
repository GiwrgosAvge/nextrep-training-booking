export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const commonPasswords = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "12341234",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwertyui",
  "qwerty123",
  "asdfghjk",
  "abc12345",
  "iloveyou",
  "letmein1",
  "nextrep",
  "nextrep1",
  "nextrep123",
  "nextrep2026",
  "training",
  "trainer",
  "gymgymgym",
  "kodikos",
  "kodikos1",
]);

export interface PasswordContext {
  username: string;
  currentPassword: string;
}

// Επιστρέφει ελληνικό μήνυμα σφάλματος ή null όταν ο κωδικός γίνεται δεκτός.
export function validateNewPassword(
  newPassword: string,
  { username, currentPassword }: PasswordContext,
): string | null {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Ο νέος κωδικός πρέπει να έχει τουλάχιστον ${MIN_PASSWORD_LENGTH} χαρακτήρες.`;
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return `Ο νέος κωδικός δεν μπορεί να ξεπερνά τους ${MAX_PASSWORD_LENGTH} χαρακτήρες.`;
  }
  if (newPassword === currentPassword) {
    return "Ο νέος κωδικός πρέπει να είναι διαφορετικός από τον τρέχοντα.";
  }
  const lowerCase = newPassword.toLowerCase();
  if (lowerCase === username.toLowerCase()) {
    return "Ο κωδικός δεν μπορεί να είναι ίδιος με το όνομα χρήστη.";
  }
  if (commonPasswords.has(lowerCase)) {
    return "Αυτός ο κωδικός είναι πολύ συνηθισμένος. Διάλεξε κάτι πιο δικό σου.";
  }
  return null;
}
