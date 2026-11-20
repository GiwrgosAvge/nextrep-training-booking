import { createContext, useContext } from 'react'

export type UserRole = 'trainer' | 'client'

export interface AuthUser {
  id: string
  username: string
  role: UserRole
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AuthUser; mustChangePassword: boolean }
  | { status: 'error'; message: string }

export interface AuthContextValue {
  state: AuthState
  login: (username: string, password: string) => Promise<{
    user: AuthUser
    mustChangePassword: boolean
  }>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('Το useAuth πρέπει να χρησιμοποιείται μέσα σε AuthProvider.')
  }
  return context
}
