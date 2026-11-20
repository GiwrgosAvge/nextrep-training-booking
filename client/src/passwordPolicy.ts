// Ίδιοι κανόνες με το server/src/passwordPolicy.ts. Ο server είναι αυτός που αποφασίζει.
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

const commonPasswords = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  '12341234',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwertyui',
  'qwerty123',
  'asdfghjk',
  'abc12345',
  'iloveyou',
  'letmein1',
  'nextrep',
  'nextrep1',
  'nextrep123',
  'nextrep2026',
  'training',
  'trainer',
  'gymgymgym',
  'kodikos',
  'kodikos1',
])

export interface PasswordChecks {
  longEnough: boolean
  differentFromCurrent: boolean
  notUsername: boolean
  notCommon: boolean
}

export function checkNewPassword(
  newPassword: string,
  username: string,
  currentPassword: string,
): PasswordChecks {
  const lowerCase = newPassword.toLowerCase()
  return {
    longEnough: newPassword.length >= MIN_PASSWORD_LENGTH,
    differentFromCurrent: newPassword !== '' && newPassword !== currentPassword,
    notUsername: newPassword !== '' && lowerCase !== username.toLowerCase(),
    notCommon: newPassword !== '' && !commonPasswords.has(lowerCase),
  }
}

export function isPasswordAcceptable(checks: PasswordChecks): boolean {
  return Object.values(checks).every(Boolean)
}

export type PasswordStrength = 'weak' | 'medium' | 'strong'

// Απλή εκτίμηση βάσει μήκους και ποικιλίας· δεν αντικαθιστά τους κανόνες.
export function getPasswordStrength(newPassword: string, accepted: boolean): PasswordStrength {
  if (!accepted) {
    return 'weak'
  }
  const kinds = [/[a-zα-ω]/, /[A-ZΑ-Ω]/, /\d/, /[^\p{L}\d]/u].filter((pattern) =>
    pattern.test(newPassword),
  ).length
  if (newPassword.length >= 14 || (newPassword.length >= 10 && kinds >= 3)) {
    return 'strong'
  }
  return 'medium'
}
