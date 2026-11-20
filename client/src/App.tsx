import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentType, type FocusEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { type AuthUser, type UserRole, useAuth } from './AuthContext'
import { ButtonFeedback } from './ButtonFeedback'
import { BottomSheet } from './BottomSheet'
import { ClientDashboard } from './ClientDashboard'
import { getInitials } from './appointmentTime'
import type { FlashState } from './flashToast'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkNewPassword,
  getPasswordStrength,
  isPasswordAcceptable,
  type PasswordStrength,
} from './passwordPolicy'
import { TrainerDashboard } from './TrainerDashboard'
import './App.css'
import './MobileFirst.css'

type ThemePreference = 'system' | 'light' | 'dark'
type Theme = Exclude<ThemePreference, 'system'>

interface ThemeContextValue {
  theme: Theme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getThemePreference(): ThemePreference {
  try {
    const preference = localStorage.getItem('nextrep-theme')
    if (preference === 'light' || preference === 'dark') {
      return preference
    }
  } catch (error) {
    console.error('Δεν ήταν δυνατή η ανάγνωση της προτίμησης εμφάνισης.', error)
  }
  return 'system'
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference)
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const theme = preference === 'system' ? systemTheme : preference

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'dark' : 'light')

    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      if (preference === 'system') {
        localStorage.removeItem('nextrep-theme')
      } else {
        localStorage.setItem('nextrep-theme', preference)
      }
    } catch (error) {
      console.error('Δεν ήταν δυνατή η αποθήκευση της προτίμησης εμφάνισης.', error)
    }
  }, [preference, theme])

  function toggleTheme() {
    setPreference(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

const themeOptions: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: 'system',
    label: 'Αυτόματο',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="12" rx="2" width="18" x="3" y="4" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Φωτεινό',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Σκούρο',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20.4 15.4A8.5 8.5 0 0 1 8.6 3.6 8.5 8.5 0 1 0 20.4 15.4Z" />
      </svg>
    ),
  },
]

// Επιλογέας τριών επιλογών: radiogroup με πλήκτρα βέλους, όπως τα native radio buttons.
function ThemeSegmentedControl() {
  const themeContext = useContext(ThemeContext)
  if (!themeContext) {
    throw new Error('Ο επιλογέας θέματος πρέπει να βρίσκεται μέσα στο ThemeProvider.')
  }
  const { preference, setPreference } = themeContext

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const index = themeOptions.findIndex((option) => option.value === preference)
    const next = themeOptions[(index + step + themeOptions.length) % themeOptions.length]
    setPreference(next.value)
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus()
  }

  return (
    <div
      aria-label="Θέμα εμφάνισης"
      className="theme-segmented"
      onKeyDown={handleKeyDown}
      role="radiogroup"
    >
      {themeOptions.map((option) => (
        <button
          aria-checked={preference === option.value}
          className={preference === option.value ? 'theme-segment is-selected' : 'theme-segment'}
          data-value={option.value}
          key={option.value}
          onClick={() => setPreference(option.value)}
          role="radio"
          tabIndex={preference === option.value ? 0 : -1}
          type="button"
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function ThemeToggle() {
  const themeContext = useContext(ThemeContext)
  if (!themeContext) {
    throw new Error('Το κουμπί θέματος πρέπει να βρίσκεται μέσα στο ThemeProvider.')
  }

  const { theme, toggleTheme } = themeContext
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const label = nextTheme === 'dark'
    ? 'Ενεργοποίηση σκούρου θέματος'
    : 'Ενεργοποίηση ανοιχτού θέματος'

  return (
    <button
      aria-label={label}
      aria-pressed={theme === 'dark'}
      className="theme-toggle"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      {theme === 'dark' ? (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M20.4 15.4A8.5 8.5 0 0 1 8.6 3.6 8.5 8.5 0 1 0 20.4 15.4Z" />
        </svg>
      )}
    </button>
  )
}

function getHomePath(role: UserRole): string {
  return role === 'trainer' ? '/trainer' : '/client'
}

function keepLoginFieldVisible(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget
  window.setTimeout(() => {
    scrollLoginFieldIntoView(input)
  }, 300)
}

function scrollLoginFieldIntoView(input: HTMLInputElement) {
  const page = input.closest<HTMLElement>('.auth-page')
  if (!page || page.scrollHeight <= page.clientHeight) {
    return
  }

  const viewportBottom = window.visualViewport?.height ?? window.innerHeight
  const inputRect = input.getBoundingClientRect()
  const submitRect = page.querySelector('.auth-submit')?.getBoundingClientRect()
  const visibleTop = window.visualViewport?.offsetTop ?? 0
  const visibleBottom = viewportBottom - 24
  const contentBottom = Math.max(inputRect.bottom, submitRect?.bottom ?? inputRect.bottom)
  let scrollDelta = 0

  if (inputRect.top < visibleTop + 24) {
    scrollDelta = inputRect.top - (visibleTop + 24)
  } else if (contentBottom > visibleBottom) {
    scrollDelta = contentBottom - visibleBottom
  }

  if (scrollDelta !== 0) {
    page.scrollTo({ top: Math.max(0, page.scrollTop + scrollDelta), behavior: 'smooth' })
  }
}

function PageMessage({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <main className={compact ? 'page-shell auth-page auth-page-compact' : 'page-shell auth-page'}>
      {!compact && <ThemeToggle />}
      <section className="auth-card" aria-live="polite">
        {!compact && (
          <>
            <div className="auth-brand">
              <img className="auth-brand-mark" src="/nextrep.svg" alt="" />
              <span>NextRep</span>
            </div>
            <p className="eyebrow">ΚΡΑΤΗΣΕΙΣ ΠΡΟΠΟΝΗΣΕΩΝ</p>
          </>
        )}
        {children}
      </section>
    </main>
  )
}

function AuthLoading() {
  return (
    <PageMessage>
      <h1>Έλεγχος σύνδεσης</h1>
      <p className="intro-copy" role="status">Περιμένετε λίγο…</p>
    </PageMessage>
  )
}

function AuthError() {
  const { state, refresh } = useAuth()
  const [isRetrying, setIsRetrying] = useState(false)
  if (state.status !== 'error') {
    return null
  }

  return (
    <PageMessage>
      <h1>Δεν ήταν δυνατή η σύνδεση</h1>
      <p className="notice notice-error" role="alert">{state.message}</p>
      <button
        aria-busy={isRetrying}
        className="book-button"
        disabled={isRetrying}
        onClick={() => {
          setIsRetrying(true)
          void refresh().finally(() => setIsRetrying(false))
        }}
        type="button"
      >
        <ButtonFeedback
          idleText="Δοκίμασε ξανά"
          loading={isRetrying}
          loadingText="Σύνδεση…"
        />
      </button>
    </PageMessage>
  )
}

function LoginPage() {
  const { state, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Μετά την έξοδο δεν πρέπει να μείνει στην καρτέλα ο τίτλος της προηγούμενης οθόνης.
  useEffect(() => {
    document.title = 'Σύνδεση | NextRep'
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) {
      return
    }

    function handleViewportResize() {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLInputElement) {
        scrollLoginFieldIntoView(activeElement)
      }
    }

    viewport.addEventListener('resize', handleViewportResize)
    return () => viewport.removeEventListener('resize', handleViewportResize)
  }, [])

  if (state.status === 'loading') {
    return <AuthLoading />
  }
  if (state.status === 'error') {
    return <AuthError />
  }
  if (state.status === 'authenticated') {
    return (
      <Navigate
        replace
        to={state.mustChangePassword ? '/change-password' : getHomePath(state.user.role)}
      />
    )
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError('')
    try {
      const nextState = await login(username.trim(), password)
      navigate(
        nextState.mustChangePassword ? '/change-password' : getHomePath(nextState.user.role),
        { replace: true },
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Δεν ήταν δυνατή η σύνδεση. Έλεγξε τα στοιχεία σου και δοκίμασε ξανά.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageMessage>
      <h1>Καλώς ήρθες!</h1>
      <p className="intro-copy">Συνδέσου με τα στοιχεία που σου έδωσε ο προπονητής.</p>
      <form className="auth-form" onSubmit={(event) => void submitLogin(event)}>
        <label className="name-field">
          <span>Όνομα χρήστη</span>
          <input
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            maxLength={32}
            onChange={(event) => setUsername(event.target.value)}
            onFocus={keepLoginFieldVisible}
            placeholder="π.χ. maria_papadopoulou"
            required
            spellCheck={false}
            value={username}
          />
        </label>
        <div className="name-field">
          <label htmlFor="login-password">Κωδικός</label>
          <span className="password-input-wrap">
            <input
              autoComplete="current-password"
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              onFocus={keepLoginFieldVisible}
              required
              type={isPasswordVisible ? 'text' : 'password'}
              value={password}
            />
            <button
              aria-label={isPasswordVisible ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}
              aria-pressed={isPasswordVisible}
              className="password-visibility-toggle"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              type="button"
            >
              {isPasswordVisible ? (
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c5.5 0 9 7 9 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.9 7.8 3 12 3 12s3.5 7 9 7a10 10 0 0 0 3-.5" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </span>
        </div>
        {error && (
          <p className="notice notice-error login-error" role="alert">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5m0 3h.01" />
            </svg>
            <span>{error}</span>
          </p>
        )}
        <button
          aria-busy={isSubmitting}
          className="book-button auth-submit"
          disabled={isSubmitting}
          type="submit"
        >
          <ButtonFeedback
            idleText="Σύνδεση"
            loading={isSubmitting}
            loadingText="Σύνδεση…"
          />
        </button>
        <p className="login-help">
          Ξέχασες τον κωδικό σου; Ζήτα από τον προπονητή σου να τον αλλάξει.
        </p>
      </form>
    </PageMessage>
  )
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
}: {
  id: string
  label: string
  autoComplete: 'current-password' | 'new-password'
  value: string
  onChange: (value: string) => void
}) {
  const [isVisible, setIsVisible] = useState(false)
  return (
    <div className="name-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input-wrap">
        <input
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect="off"
          id={id}
          maxLength={MAX_PASSWORD_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          required
          spellCheck={false}
          type={isVisible ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={`${isVisible ? 'Απόκρυψη' : 'Εμφάνιση'}: ${label}`}
          aria-pressed={isVisible}
          className="password-visibility-toggle"
          onClick={() => setIsVisible((visible) => !visible)}
          type="button"
        >
          {isVisible ? (
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c5.5 0 9 7 9 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.9 7.8 3 12 3 12s3.5 7 9 7a10 10 0 0 0 3-.5" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
    </div>
  )
}

const strengthLabels: Record<PasswordStrength, string> = {
  weak: 'Αδύναμος',
  medium: 'Καλός',
  strong: 'Δυνατός',
}

function ChangePasswordPage() {
  const { state, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    document.title = 'Διάλεξε νέο κωδικό | NextRep'
  }, [])

  if (state.status === 'loading') {
    return <AuthLoading />
  }
  if (state.status === 'error') {
    return <AuthError />
  }
  if (state.status === 'anonymous') {
    return <Navigate replace to="/login" />
  }
  const user = state.user
  const isMandatory = state.mustChangePassword
  const checks = checkNewPassword(newPassword, user.username, currentPassword)
  const isAcceptable = isPasswordAcceptable(checks)
  const strength = getPasswordStrength(newPassword, isAcceptable)
  const passwordsMatch = newPassword !== '' && newPassword === confirmPassword
  const canSubmit = currentPassword !== '' && isAcceptable && passwordsMatch && !isSubmitting
  const requirements = [
    { met: checks.longEnough, text: `Τουλάχιστον ${MIN_PASSWORD_LENGTH} χαρακτήρες` },
    { met: checks.differentFromCurrent, text: 'Διαφορετικός από τον τρέχοντα' },
    { met: checks.notUsername && checks.notCommon, text: 'Όχι όνομα χρήστη ή συνηθισμένος κωδικός' },
  ]

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      const flash: FlashState = { toast: 'Ο κωδικός άλλαξε' }
      navigate(getHomePath(user.role), { replace: true, state: flash })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Δεν ήταν δυνατή η αλλαγή του κωδικού.',
      )
      setIsSubmitting(false)
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Δεν ήταν δυνατή η έξοδος.',
      )
      setIsLoggingOut(false)
    }
  }

  return (
    <PageMessage compact>
      {!isMandatory && (
        <button
          className="auth-back-button"
          onClick={() => navigate(getHomePath(user.role))}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 5-7 7 7 7" />
          </svg>
          Πίσω
        </button>
      )}
      <h1>Διάλεξε νέο κωδικό</h1>
      <p className="intro-copy">
        Διάλεξε έναν κωδικό που θα θυμάσαι, τουλάχιστον {MIN_PASSWORD_LENGTH} χαρακτήρες. Μην τον πεις σε κανέναν.
      </p>
      {isMandatory && (
        <p className="auth-mandatory-note">Πρέπει να διαλέξεις δικό σου κωδικό πριν συνεχίσεις</p>
      )}
      <form className="auth-form" onSubmit={(event) => void submitPasswordChange(event)}>
        <PasswordField
          autoComplete="current-password"
          id="current-password"
          label="Ο κωδικός που έχεις τώρα"
          onChange={setCurrentPassword}
          value={currentPassword}
        />
        <PasswordField
          autoComplete="new-password"
          id="new-password"
          label="Νέος κωδικός"
          onChange={setNewPassword}
          value={newPassword}
        />
        <div className="password-hints">
          <div className="password-strength" data-strength={newPassword === '' ? 'none' : strength}>
            <span aria-hidden="true" className="password-strength-bar" />
            <span aria-live="polite">
              {newPassword === '' ? 'Δύναμη κωδικού' : `Δύναμη: ${strengthLabels[strength]}`}
            </span>
          </div>
          <ul className="password-requirements">
            {requirements.map((requirement) => (
              <li className={requirement.met ? 'is-met' : undefined} key={requirement.text}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  {requirement.met ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="4" />}
                </svg>
                <span>
                  {requirement.text}
                  <span className="visually-hidden">{requirement.met ? ' (ισχύει)' : ' (δεν ισχύει ακόμα)'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <PasswordField
          autoComplete="new-password"
          id="confirm-password"
          label="Ξανά ο νέος κωδικός"
          onChange={setConfirmPassword}
          value={confirmPassword}
        />
        {confirmPassword !== '' && (
          <p
            className={passwordsMatch ? 'password-match is-match' : 'password-match'}
            role="status"
          >
            {passwordsMatch ? 'Ταιριάζουν' : 'Δεν ταιριάζουν'}
          </p>
        )}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button
          aria-busy={isSubmitting}
          className="book-button auth-submit"
          disabled={!canSubmit}
          type="submit"
        >
          <ButtonFeedback
            idleText="Αλλαγή κωδικού"
            loading={isSubmitting}
            loadingText="Αποθήκευση…"
          />
        </button>
        {isMandatory ? (
          <button
            aria-busy={isLoggingOut}
            className="cancel-button auth-secondary"
            disabled={isSubmitting || isLoggingOut}
            onClick={() => void handleLogout()}
            type="button"
          >
            <ButtonFeedback idleText="Έξοδος" loading={isLoggingOut} loadingText="Έξοδος…" />
          </button>
        ) : (
          <button
            className="cancel-button auth-secondary"
            disabled={isSubmitting}
            onClick={() => navigate(getHomePath(user.role))}
            type="button"
          >
            Ακύρωση
          </button>
        )}
      </form>
    </PageMessage>
  )
}

function ProtectedRoute({ role }: { role: UserRole }) {
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') {
    return <AuthLoading />
  }
  if (state.status === 'error') {
    return <AuthError />
  }
  if (state.status === 'anonymous') {
    return <Navigate replace state={{ from: location }} to="/login" />
  }
  if (state.mustChangePassword) {
    return <Navigate replace to="/change-password" />
  }
  if (state.user.role !== role) {
    return <Navigate replace to={getHomePath(state.user.role)} />
  }
  return <Outlet />
}

function AuthenticatedRoute() {
  const { state } = useAuth()

  if (state.status === 'loading') {
    return <AuthLoading />
  }
  if (state.status === 'error') {
    return <AuthError />
  }
  if (state.status === 'anonymous') {
    return <Navigate replace to="/login" />
  }
  return <Outlet />
}

type NavigationItem<Section extends string> = {
  id: Section
  label: string
  icon: 'calendar' | 'people' | 'check' | 'today' | 'time'
}

type ClientSection = 'available-hours' | 'my-bookings'
type TrainerSection = 'trainer-today' | 'trainer-appointments' | 'trainer-hours' | 'trainer-clients'
type NoticeResetRegistration = (reset: () => void) => () => void
type ProfileSheetState = 'menu' | 'logout-confirmation' | null
type DashboardProps<Section extends string> = {
  activeSection: Section
  registerNoticeReset: NoticeResetRegistration
  navigateToSection?: (section: Section) => void
}

function AppNavigation<Section extends string>({
  items,
  activeSection,
  onSelect,
}: {
  items: NavigationItem<Section>[]
  activeSection: Section
  onSelect: (section: Section) => void
}) {

  return (
    <nav className="app-navigation" aria-label="Κύρια πλοήγηση">
      {items.map((item) => (
        <button
          aria-current={activeSection === item.id ? 'page' : undefined}
          className={activeSection === item.id ? 'app-nav-link is-active' : 'app-nav-link'}
          onClick={() => onSelect(item.id)}
          key={item.id}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            {item.icon === 'calendar' && (
              <>
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
                <path d="M7.5 3.5v3M16.5 3.5v3M4 9.5h16" />
              </>
            )}
            {item.icon === 'people' && (
              <>
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19v-1.3a4.2 4.2 0 0 1 4.2-4.2h2.6a4.2 4.2 0 0 1 4.2 4.2V19M16 5.5a3 3 0 0 1 0 5.8m1.2 2.3a4.2 4.2 0 0 1 3.3 4.1V19" />
              </>
            )}
            {item.icon === 'check' && (
              <>
                <rect x="4" y="4" width="16" height="16" rx="4" />
                <path d="m8 12 2.6 2.6L16.5 9" />
              </>
            )}
            {item.icon === 'today' && (
              <>
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
                <path d="M7.5 3.5v3M16.5 3.5v3M4 9.5h16M8 13h2m4 0h2m-8 3h2m4 0h2" />
              </>
            )}
            {item.icon === 'time' && (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3.5 2" />
              </>
            )}
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function ApplicationLayout<Section extends string>({
  user,
  headings,
  items,
  initialSection,
  dashboardComponent: DashboardComponent,
}: {
  user: AuthUser
  headings: Record<Section, { title: string; subtitle: string }>
  items: NavigationItem<Section>[]
  initialSection: Section
  dashboardComponent: ComponentType<DashboardProps<Section>>
}) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [profileSheet, setProfileSheet] = useState<ProfileSheetState>(null)
  const [activeSection, setActiveSection] = useState(initialSection)
  const { title, subtitle } = headings[activeSection]

  useEffect(() => {
    document.title = `${title} | NextRep`
  }, [title])
  const noticeResetRef = useRef<(() => void) | null>(null)
  const registerNoticeReset = useCallback<NoticeResetRegistration>((reset) => {
    noticeResetRef.current = reset
    return () => {
      if (noticeResetRef.current === reset) {
        noticeResetRef.current = null
      }
    }
  }, [])

  function handleSectionSelect(section: Section) {
    if (section === activeSection) {
      return
    }
    noticeResetRef.current?.()
    setError('')
    setActiveSection(section)
  }

  function closeProfileSheet() {
    setProfileSheet(null)
    setError('')
  }

  async function handleLogout() {
    setIsLoggingOut(true)
    setError('')
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Δεν ήταν δυνατή η αποσύνδεση.',
      )
      setIsLoggingOut(false)
    }
  }

  return (
    <main className="page-shell application-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="NextRep — Αρχική σελίδα">
          <img className="brand-mark" src="/nextrep.svg" alt="" aria-hidden="true" />
          <span>NextRep</span>
        </Link>
        <button
          aria-label="Άνοιγμα προφίλ"
          className="profile-button"
          onClick={() => setProfileSheet('menu')}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
        </button>
      </header>
      {user.role === 'client' && (
        <section className="intro">
          <h1>{title}</h1>
          <p className="intro-copy">{subtitle}</p>
        </section>
      )}
      {error && profileSheet === null && (
        <p className="notice notice-error" role="alert">{error}</p>
      )}
      <AppNavigation
        activeSection={activeSection}
        items={items}
        onSelect={handleSectionSelect}
      />
      <div className="dashboard-scroll-area">
        <div className="dashboard-panel">
          <DashboardComponent
            activeSection={activeSection}
            navigateToSection={handleSectionSelect}
            registerNoticeReset={registerNoticeReset}
          />
        </div>
      </div>
      <BottomSheet
        description={
          profileSheet === 'logout-confirmation'
            ? 'Θα χρειαστεί να συνδεθείς ξανά για να μπεις στην εφαρμογή.'
            : undefined
        }
        onClose={closeProfileSheet}
        open={profileSheet !== null}
        title={profileSheet === 'logout-confirmation' ? 'Να βγεις από τον λογαριασμό;' : 'Προφίλ'}
      >
        {profileSheet === 'menu' && (
          <div className="profile-menu">
            <div className="profile-user">
              <span aria-hidden="true" className="profile-avatar">{getInitials(user.username)}</span>
              <span>
                Συνδεδεμένος ως <strong>{user.username}</strong>
              </span>
            </div>
            <div className="profile-section">
              <span className="profile-section-label">Θέμα</span>
              <ThemeSegmentedControl />
            </div>
            <Link
              className="cancel-button profile-action"
              onClick={closeProfileSheet}
              to="/change-password"
            >
              <svg aria-hidden="true" className="profile-icon" viewBox="0 0 24 24">
                <circle cx="8" cy="15" r="4" />
                <path d="m11 12 8-8m-3 3 3 3m-6-6 2 2" />
              </svg>
              Αλλαγή κωδικού
            </Link>
            <hr className="profile-divider" />
            <button
              className="profile-logout"
              onClick={() => {
                setError('')
                setProfileSheet('logout-confirmation')
              }}
              type="button"
            >
              <svg aria-hidden="true" className="profile-icon" viewBox="0 0 24 24">
                <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />
              </svg>
              Έξοδος
            </button>
          </div>
        )}
        {profileSheet === 'logout-confirmation' && (
          <div className="bottom-sheet-actions">
            {error && <p className="notice notice-error" role="alert">{error}</p>}
            <button
              aria-busy={isLoggingOut}
              className="cancel-button bottom-sheet-destructive"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, έξοδος"
                loading={isLoggingOut}
                loadingText="Έξοδος…"
              />
            </button>
            <button
              className="book-button"
              disabled={isLoggingOut}
              onClick={() => setProfileSheet('menu')}
              type="button"
            >
              Όχι, μένω
            </button>
          </div>
        )}
      </BottomSheet>
    </main>
  )
}

function ClientHome() {
  const { state } = useAuth()
  return state.status === 'authenticated'
    ? (
        <ApplicationLayout<ClientSection>
          initialSection="available-hours"
          items={[
            { id: 'available-hours', label: 'Κράτηση', icon: 'calendar' },
            { id: 'my-bookings', label: 'Ραντεβού', icon: 'check' },
          ]}
          dashboardComponent={ClientDashboard}
          headings={{
            'available-hours': {
              title: 'Κλείσε προπόνηση',
              subtitle: 'Διάλεξε μέρα και ώρα που σε βολεύει.',
            },
            'my-bookings': {
              title: 'Τα ραντεβού μου',
              subtitle: 'Εδώ βλέπεις, αλλάζεις ή ακυρώνεις την προπόνησή σου.',
            },
          }}
          user={state.user}
        />
      )
    : null
}

function TrainerHome() {
  const { state } = useAuth()
  return state.status === 'authenticated'
    ? (
        <ApplicationLayout<TrainerSection>
          initialSection="trainer-today"
          items={[
            { id: 'trainer-today', label: 'Σήμερα', icon: 'today' },
            { id: 'trainer-appointments', label: 'Ραντεβού', icon: 'check' },
            { id: 'trainer-hours', label: 'Ώρες', icon: 'time' },
            { id: 'trainer-clients', label: 'Ασκούμενοι', icon: 'people' },
          ]}
          dashboardComponent={TrainerDashboard}
          headings={{
            'trainer-today': { title: 'Σήμερα', subtitle: '' },
            'trainer-appointments': { title: 'Ραντεβού', subtitle: '' },
            'trainer-hours': { title: 'Ώρες', subtitle: '' },
            'trainer-clients': { title: 'Ασκούμενοι', subtitle: '' },
          }}
          user={state.user}
        />
      )
    : null
}

function HomeRedirect() {
  const { state } = useAuth()
  if (state.status === 'loading') {
    return <AuthLoading />
  }
  if (state.status === 'error') {
    return <AuthError />
  }
  if (state.status === 'anonymous') {
    return <Navigate replace to="/login" />
  }
  return (
    <Navigate
      replace
      to={state.mustChangePassword ? '/change-password' : getHomePath(state.user.role)}
    />
  )
}

function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthenticatedRoute />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>
        <Route element={<ProtectedRoute role="client" />}>
          <Route path="/client" element={<ClientHome />} />
        </Route>
        <Route element={<ProtectedRoute role="trainer" />}>
          <Route path="/trainer" element={<TrainerHome />} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </ThemeProvider>
  )
}

export default App
