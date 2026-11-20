import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type AuthUser,
} from './AuthContext'

interface AuthResponse {
  user: AuthUser | null
  mustChangePassword: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    (value.role === 'trainer' || value.role === 'client')
  )
}

function parseAuthResponse(value: unknown): AuthResponse {
  if (
    !isRecord(value) ||
    !(value.user === null || isAuthUser(value.user)) ||
    typeof value.mustChangePassword !== 'boolean'
  ) {
    throw new Error('Ο server επέστρεψε στοιχεία σύνδεσης σε μη αναμενόμενη μορφή.')
  }
  return { user: value.user, mustChangePassword: value.mustChangePassword }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('Ο server επέστρεψε απάντηση σε μη αναμενόμενη μορφή.')
  }
}

async function readError(response: Response): Promise<string> {
  const data = await readJson(response)
  if (isRecord(data) && typeof data.error === 'string') {
    return data.error
  }
  return 'Δεν ήταν δυνατή η επικοινωνία με τον server.'
}

async function getAuthState(): Promise<AuthState> {
  const response = await fetch('/api/auth/me', { credentials: 'include' })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const authResponse = parseAuthResponse(await readJson(response))
  return authResponse.user
    ? {
        status: 'authenticated',
        user: authResponse.user,
        mustChangePassword: authResponse.mustChangePassword,
      }
    : { status: 'anonymous' }
}

function toErrorState(error: unknown): AuthState {
  console.error(error)
  return {
    status: 'error',
    message: error instanceof Error ? error.message : 'Δεν ήταν δυνατή η σύνδεση με τον server.',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      setState(await getAuthState())
    } catch (error) {
      setState(toErrorState(error))
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    void getAuthState()
      .then((currentState) => {
        if (isMounted) {
          setState(currentState)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setState(toErrorState(error))
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const login = useCallback<AuthContextValue['login']>(async (username, password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    const authResponse = parseAuthResponse(await readJson(response))
    if (!authResponse.user) {
      throw new Error('Ο server δεν επέστρεψε συνδεδεμένο χρήστη.')
    }
    setState({
      status: 'authenticated',
      user: authResponse.user,
      mustChangePassword: authResponse.mustChangePassword,
    })
    return {
      user: authResponse.user,
      mustChangePassword: authResponse.mustChangePassword,
    }
  }, [])

  const logout = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    setState({ status: 'anonymous' })
  }, [])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, newPassword }),
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      setState((currentState) =>
        currentState.status === 'authenticated'
          ? { ...currentState, mustChangePassword: false }
          : currentState,
      )
    },
    [],
  )

  const contextValue = useMemo(
    () => ({ state, login, logout, changePassword, refresh }),
    [state, login, logout, changePassword, refresh],
  )

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}
