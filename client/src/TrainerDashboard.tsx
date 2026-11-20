import { useCallback, useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react'
import { useFlashToast } from './useFlashToast'
import { AddSlotForm } from './AddSlotForm'
import { EditAppointmentForm } from './EditAppointmentForm'
import {
  activeAccountsLabel,
  appointmentCount,
  deleteClientWarning,
  freeBadgeLabel,
  getInitials,
  matchesSearch,
  partitionByTime,
  pluralWord,
  upcomingAppointmentsCount,
} from './appointmentTime'
import { BottomSheet } from './BottomSheet'
import { ButtonFeedback } from './ButtonFeedback'
import { CredentialsCard } from './CredentialsCard'

interface TrainerSlot {
  id: string
  startsAt: string
  appointmentId: string | null
  clientId: string | null
  clientUsername: string | null
  legacyClientName: string | null
}

interface TrainerClient {
  id: string
  username: string
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  appointmentCount: number
  upcomingAppointmentCount: number
}

interface TrainerData {
  slots: TrainerSlot[]
  clients: TrainerClient[]
  loadedAt: number
}

type TrainerSection =
  | 'trainer-today'
  | 'trainer-appointments'
  | 'trainer-hours'
  | 'trainer-clients'

type TrainerSheet =
  | { kind: 'add-slot' }
  | { kind: 'edit-appointment'; slot: TrainerSlot }
  | { kind: 'cancel-appointment'; slot: TrainerSlot }
  | { kind: 'delete-slot'; slot: TrainerSlot }
  | { kind: 'new-client' }
  | { kind: 'client-actions'; client: TrainerClient }
  | { kind: 'deactivate-client'; client: TrainerClient }
  | { kind: 'reset-password'; client: TrainerClient }
  | { kind: 'delete-client'; client: TrainerClient }
  | null

interface TemporaryPassword {
  title: string
  username: string
  value: string
}

class TrainerRequestError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isTrainerSlot(value: unknown): value is TrainerSlot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startsAt === 'string' &&
    isNullableString(value.appointmentId) &&
    isNullableString(value.clientId) &&
    isNullableString(value.clientUsername) &&
    isNullableString(value.legacyClientName)
  )
}

function isTrainerClient(value: unknown): value is TrainerClient {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    typeof value.isActive === 'boolean' &&
    typeof value.mustChangePassword === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.appointmentCount === 'number' &&
    typeof value.upcomingAppointmentCount === 'number'
  )
}

function formatDate(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(startsAt))
}

function formatDayAndMonth(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startsAt))
}

function formatTime(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(startsAt))
}

function groupSlotsByDay(slots: TrainerSlot[]) {
  const sortedSlots = [...slots].sort(
    (first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt),
  )
  const groups = new Map<string, TrainerSlot[]>()

  for (const slot of sortedSlots) {
    const date = new Date(slot.startsAt)
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const group = groups.get(dateKey)
    if (group) {
      group.push(slot)
    } else {
      groups.set(dateKey, [slot])
    }
  }

  return Array.from(groups.values(), (groupSlots) => ({
    date: formatDate(groupSlots[0].startsAt),
    slots: groupSlots,
  }))
}

async function sendRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  })

  let data: unknown = null
  if (response.status !== 204) {
    try {
      data = await response.json()
    } catch {
      if (response.ok) {
        throw new TrainerRequestError('Ο server επέστρεψε απάντηση σε μη αναμενόμενη μορφή.')
      }
    }
  }

  if (!response.ok) {
    throw new TrainerRequestError(
      isRecord(data) && typeof data.error === 'string'
        ? data.error
        : 'Δεν ήταν δυνατή η ολοκλήρωση του αιτήματος.',
    )
  }
  return data
}

async function loadTrainerData(signal?: AbortSignal): Promise<TrainerData> {
  const [slotsData, clientsData] = await Promise.all([
    sendRequest('/api/trainer/slots', { signal }),
    sendRequest('/api/trainer/clients', { signal }),
  ])

  if (
    !isRecord(slotsData) ||
    !Array.isArray(slotsData.slots) ||
    !slotsData.slots.every(isTrainerSlot) ||
    !isRecord(clientsData) ||
    !Array.isArray(clientsData.clients) ||
    !clientsData.clients.every(isTrainerClient)
  ) {
    throw new TrainerRequestError('Ο server επέστρεψε πρόγραμμα σε μη αναμενόμενη μορφή.')
  }

  return { slots: slotsData.slots, clients: clientsData.clients, loadedAt: Date.now() }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function ClientBadge({ slot, variant = 'status' }: { slot: TrainerSlot; variant?: 'status' | 'person' }) {
  const name = slot.clientUsername ?? slot.legacyClientName ?? 'Χωρίς όνομα'
  if (variant === 'person') {
    return (
      <span className="trainer-person">
        <span aria-hidden="true" className="trainer-avatar">{getInitials(name)}</span>
        <span className="trainer-person-name">{name}</span>
      </span>
    )
  }
  return (
    <span className="trainer-booking-status is-booked">
      <span>Κλεισμένη · {name}</span>
    </span>
  )
}

export function TrainerDashboard({
  activeSection,
  registerNoticeReset,
  navigateToSection,
}: {
  activeSection: TrainerSection
  registerNoticeReset: (reset: () => void) => () => void
  navigateToSection?: (section: TrainerSection) => void
}) {
  const [data, setData] = useState<TrainerData | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [toast, setToast] = useFlashToast()
  const [now, setNow] = useState(() => Date.now())
  const [newClientUsername, setNewClientUsername] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState<TemporaryPassword | null>(null)
  const [activeSheet, setActiveSheet] = useState<TrainerSheet>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const pullDistanceRef = useRef(0)
  const pullStartY = useRef<number | null>(null)
  const swipeStart = useRef<{
    x: number
    y: number
    sheet: Exclude<TrainerSheet, null>
  } | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const slots = data?.slots ?? []
  const clients = data?.clients ?? []
  const activeClients = clients.filter((client) => client.isActive)
  const visibleClients =
    clientSearch.trim() === ''
      ? clients
      : clients.filter((client) => matchesSearch(client.username, clientSearch))
  // Μία μόνο διαχωριστική γραμμή «μελλοντικό / παλιό» για tiles, badges και λίστες,
  // ώστε οι αριθμοί να συμφωνούν πάντα.
  const { upcoming: upcomingSlots, past: pastSlots } = partitionByTime(slots, now)
  const isBooked = (slot: TrainerSlot) => slot.appointmentId !== null
  const availableSlots = upcomingSlots.filter((slot) => !isBooked(slot))
  const upcomingAppointments = upcomingSlots.filter(isBooked)
  const pastAppointments = pastSlots.filter(isBooked)
  const todayKey = new Date(now).toDateString()
  const todayAppointments = upcomingAppointments.filter(
    (slot) => new Date(slot.startsAt).toDateString() === todayKey,
  )
  const displayedSlots =
    activeSection === 'trainer-hours' ? upcomingSlots : upcomingAppointments
  const pastDisplayedSlots = activeSection === 'trainer-hours' ? [] : pastAppointments
  const slotDayGroups = groupSlotsByDay(displayedSlots)
  const pastDayGroups = groupSlotsByDay(pastDisplayedSlots).reverse()
  const isLoading = data === null && error === ''

  useEffect(
    () =>
      registerNoticeReset(() => {
        setError('')
        setMessage('')
        setActiveSheet(null)
      }),
    [registerNoticeReset],
  )

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsRefreshing(true)
    try {
      const nextData = await loadTrainerData(signal)
      setData(nextData)
      setNow(Date.now())
      setError('')
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let isMounted = true

    void loadTrainerData(controller.signal)
      .then((loadedData) => {
        if (isMounted) {
          setData(loadedData)
        }
      })
      .catch((caughtError: unknown) => {
        if (
          isMounted &&
          !(caughtError instanceof DOMException && caughtError.name === 'AbortError')
        ) {
          console.error(caughtError)
          setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η φόρτωση του προγράμματος.'))
        }
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh().catch((caughtError: unknown) => {
          console.error(caughtError)
          setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η ανανέωση του προγράμματος.'))
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refresh])

  function onTrainerTouchStart(event: TouchEvent<HTMLDivElement>) {
    pullDistanceRef.current = 0
    const scrollContainer = event.currentTarget.closest<HTMLElement>('.dashboard-scroll-area')
    const target = event.target
    if (
      scrollContainer &&
      scrollContainer.scrollTop <= 0 &&
      event.touches.length === 1 &&
      activeSheet === null &&
      !(target instanceof Element && target.closest('button, input, select, a'))
    ) {
      pullStartY.current = event.touches[0].clientY
    } else {
      pullStartY.current = null
    }
  }

  function onTrainerTouchMove(event: TouchEvent<HTMLDivElement>) {
    const scrollContainer = event.currentTarget.closest<HTMLElement>('.dashboard-scroll-area')
    if (
      pullStartY.current === null ||
      !scrollContainer ||
      scrollContainer.scrollTop > 0 ||
      isRefreshing
    ) {
      return
    }
    const distance = Math.max(0, Math.min(100, event.touches[0].clientY - pullStartY.current))
    pullDistanceRef.current = distance
    setPullDistance(distance)
  }

  function onTrainerTouchEnd() {
    if (
      pullDistanceRef.current >= 64 &&
      !isRefreshing &&
      pendingAction === null &&
      activeSheet === null
    ) {
      setError('')
      void refresh().catch((caughtError: unknown) => {
        console.error(caughtError)
        setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η ανανέωση του προγράμματος.'))
      })
    }
    pullStartY.current = null
    pullDistanceRef.current = 0
    setPullDistance(0)
  }

  async function runAction(
    actionId: string,
    request: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setPendingAction(actionId)
    setError('')
    setMessage('')
    try {
      await request()
      setMessage(successMessage)
      await refresh()
      return true
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η ολοκλήρωση της ενέργειας.'))
      return false
    } finally {
      setPendingAction(null)
    }
  }

  async function addSlots(startsAtList: string[]) {
    setPendingAction('add-slot')
    setError('')
    setMessage('')
    const failures: string[] = []
    let added = 0
    for (const startsAt of startsAtList) {
      try {
        await sendRequest('/api/trainer/slots', {
          method: 'POST',
          body: JSON.stringify({ startsAt }),
        })
        added += 1
      } catch (caughtError) {
        failures.push(
          `${formatTime(startsAt)}: ${errorMessage(caughtError, 'Δεν ήταν δυνατή η προσθήκη.')}`,
        )
      }
    }
    try {
      await refresh()
    } catch (refreshError) {
      console.error(refreshError)
    }
    setPendingAction(null)
    if (failures.length > 0) {
      setError(
        added > 0
          ? `Προστέθηκαν ${added}, αλλά κάποιες ώρες απέτυχαν. ${failures.join(' ')}`
          : failures.join(' '),
      )
      return
    }
    setActiveSheet(null)
    setToast(added === 1 ? 'Η ώρα προστέθηκε' : `Προστέθηκαν ${added} ώρες`)
  }

  async function deleteSlot(slot: TrainerSlot) {
    const succeeded = await runAction(
      `delete-slot-${slot.id}`,
      () => sendRequest(`/api/trainer/slots/${slot.id}`, { method: 'DELETE' }),
      slot.appointmentId ? 'Η ώρα και το ραντεβού διαγράφηκαν.' : 'Η ώρα διαγράφηκε.',
    )
    if (succeeded) {
      setActiveSheet(null)
    }
  }

  async function saveAppointment(
    slot: TrainerSlot,
    changes: { clientId?: string; slotId?: string },
  ) {
    if (!slot.appointmentId) {
      return
    }
    setPendingAction(`save-appointment-${slot.appointmentId}`)
    setError('')
    setMessage('')
    try {
      await sendRequest(`/api/trainer/appointments/${slot.appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setActiveSheet(null)
      setToast('Το ραντεβού ενημερώθηκε')
      await refresh()
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η αποθήκευση των αλλαγών.'))
      void refresh()
    } finally {
      setPendingAction(null)
    }
  }

  async function cancelAppointment(slot: TrainerSlot) {
    if (!slot.appointmentId) {
      return
    }
    const succeeded = await runAction(
      `cancel-appointment-${slot.appointmentId}`,
      () =>
        sendRequest(`/api/trainer/appointments/${slot.appointmentId}`, {
          method: 'DELETE',
        }),
      'Το ραντεβού ακυρώθηκε και η ώρα είναι ξανά διαθέσιμη.',
    )
    if (succeeded) {
      setActiveSheet(null)
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('create-client')
    setError('')
    setMessage('')
    const username = newClientUsername.trim()
    try {
      const response = await sendRequest('/api/trainer/clients', {
        method: 'POST',
        body: JSON.stringify({ username }),
      })
      if (!isRecord(response) || typeof response.temporaryPassword !== 'string') {
        throw new TrainerRequestError('Ο server δεν επέστρεψε τον προσωρινό κωδικό.')
      }
      setTemporaryPassword({
        title: 'Λογαριασμός δημιουργήθηκε',
        username,
        value: response.temporaryPassword,
      })
      setNewClientUsername('')
      setActiveSheet(null)
      await refresh()
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η δημιουργία λογαριασμού.'))
    } finally {
      setPendingAction(null)
    }
  }

  async function setClientActive(client: TrainerClient, isActive: boolean) {
    const succeeded = await runAction(
      `toggle-client-${client.id}`,
      () =>
        sendRequest(`/api/trainer/clients/${client.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive }),
        }),
      isActive ? 'Ο λογαριασμός ενεργοποιήθηκε.' : 'Ο λογαριασμός απενεργοποιήθηκε.',
    )
    if (succeeded) {
      setActiveSheet(null)
    }
  }

  async function resetClientPassword(client: TrainerClient) {
    setPendingAction(`reset-password-${client.id}`)
    setError('')
    setMessage('')
    try {
      const response = await sendRequest(
        `/api/trainer/clients/${client.id}/reset-password`,
        { method: 'POST' },
      )
      if (!isRecord(response) || typeof response.temporaryPassword !== 'string') {
        throw new TrainerRequestError('Ο server δεν επέστρεψε τον προσωρινό κωδικό.')
      }
      setTemporaryPassword({
        title: 'Νέος προσωρινός κωδικός',
        username: client.username,
        value: response.temporaryPassword,
      })
      await refresh()
      setActiveSheet(null)
    } catch (caughtError) {
      setError(errorMessage(caughtError, 'Δεν ήταν δυνατή η επαναφορά του κωδικού.'))
    } finally {
      setPendingAction(null)
    }
  }

  async function deleteClient(client: TrainerClient) {
    const succeeded = await runAction(
      `delete-client-${client.id}`,
      () => sendRequest(`/api/trainer/clients/${client.id}`, { method: 'DELETE' }),
      client.upcomingAppointmentCount > 0
        ? 'Ο λογαριασμός διαγράφηκε και τα μελλοντικά ραντεβού ακυρώθηκαν.'
        : 'Ο λογαριασμός διαγράφηκε. Το ιστορικό ραντεβού διατηρήθηκε.',
    )
    if (succeeded) {
      setActiveSheet(null)
    }
  }

  function closeSheet() {
    setError('')
    setActiveSheet(null)
  }

  function startSwipe(
    event: TouchEvent<HTMLLIElement>,
    sheet: Exclude<TrainerSheet, null>,
  ) {
    if (event.target instanceof Element && event.target.closest('button, input, select, a')) {
      swipeStart.current = null
      return
    }
    swipeStart.current = {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
      sheet,
    }
  }

  function finishSwipe(event: TouchEvent<HTMLLIElement>) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || pendingAction !== null) {
      return
    }
    const deltaX = event.changedTouches[0].clientX - start.x
    const deltaY = event.changedTouches[0].clientY - start.y
    if (deltaX <= -90 && Math.abs(deltaY) < 50) {
      setActiveSheet(start.sheet)
    }
  }

  return (
    <div
      className="trainer-dashboard-content"
      onTouchCancel={() => {
        pullStartY.current = null
        pullDistanceRef.current = 0
        setPullDistance(0)
      }}
      onTouchEnd={onTrainerTouchEnd}
      onTouchMove={onTrainerTouchMove}
      onTouchStart={onTrainerTouchStart}
    >
      <p className="pull-refresh-hint" role="status" aria-live="polite">
        {isRefreshing
          ? 'Ανανεώνουμε το πρόγραμμά σου…'
          : pullDistance >= 64
            ? 'Άφησε για ανανέωση'
            : pullDistance > 20
              ? 'Τράβηξε προς τα κάτω για ανανέωση'
              : ''}
      </p>
      {error && !activeSheet && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
      {toast && <p className="app-toast" role="status">{toast}</p>}
      {temporaryPassword && (
        <CredentialsCard
          onDone={() => setTemporaryPassword(null)}
          password={temporaryPassword.value}
          title={temporaryPassword.title}
          username={temporaryPassword.username}
        />
      )}

      {activeSection === 'trainer-today' && (
      <section className="trainer-panel trainer-today-panel" aria-labelledby="trainer-today-title">
        <div className="section-heading trainer-schedule-heading">
          <h2 id="trainer-today-title">Σήμερα</h2>
          <span className="availability-label">{appointmentCount(todayAppointments.length)}</span>
        </div>
        {isLoading ? (
          <p className="empty-state" role="status">Φορτώνουμε το πρόγραμμά σου…</p>
        ) : todayAppointments.length === 0 ? (
          <p className="empty-state">Δεν έχεις άλλα ραντεβού για σήμερα.</p>
        ) : (
          <ul className="slot-list">
            {todayAppointments.map((slot) => (
              <li className="slot-card trainer-slot-card trainer-compact-row" key={slot.id}>
                <strong className="trainer-slot-time">{formatTime(slot.startsAt)}</strong>
                              <ClientBadge slot={slot} variant="person" />
              </li>
            ))}
          </ul>
        )}
        <div className="trainer-today-summary">
          <button
            aria-label={`Προβολή επόμενων ραντεβού: ${upcomingAppointments.length}`}
            className="trainer-today-summary-link"
            onClick={() => navigateToSection?.('trainer-appointments')}
            type="button"
          >
            <strong>{upcomingAppointments.length}</strong>
            <span>{pluralWord(upcomingAppointments.length, 'επόμενο ραντεβού', 'επόμενα ραντεβού')}</span>
          </button>
          <button
            aria-label={`Προβολή ελεύθερων ωρών: ${availableSlots.length}`}
            className="trainer-today-summary-link"
            onClick={() => navigateToSection?.('trainer-hours')}
            type="button"
          >
            <strong>{availableSlots.length}</strong>
            <span>{pluralWord(availableSlots.length, 'ελεύθερη ώρα', 'ελεύθερες ώρες')}</span>
          </button>
        </div>
      </section>
      )}

      {(activeSection === 'trainer-appointments' || activeSection === 'trainer-hours') && (
      <section className="trainer-panel" aria-labelledby="trainer-schedule-title">
        <div className="section-heading trainer-schedule-heading">
          <h2 id="trainer-schedule-title">
            {activeSection === 'trainer-hours' ? 'Ώρες' : 'Ραντεβού'}
          </h2>
          <span className="availability-label">
            {activeSection === 'trainer-hours'
              ? freeBadgeLabel(availableSlots.length)
              : appointmentCount(upcomingAppointments.length)}
          </span>
        </div>

        {activeSection === 'trainer-hours' && (
        <button
          aria-label="Προσθήκη διαθέσιμης ώρας"
          className="trainer-add-slot-fab"
          onClick={() => setActiveSheet({ kind: 'add-slot' })}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        )}

        {isLoading ? (
          <p className="empty-state" role="status">Φορτώνουμε το πρόγραμμα…</p>
        ) : displayedSlots.length === 0 ? (
          <p className="empty-state">
            {activeSection === 'trainer-hours'
              ? 'Δεν υπάρχουν διαθέσιμες ώρες. Πρόσθεσε την πρώτη ώρα.'
              : 'Δεν έχεις επερχόμενα ραντεβού.'}
          </p>
        ) : (
          <div className="trainer-day-groups">
            {slotDayGroups.map(({ date, slots: daySlots }) => (
              <section className="trainer-day-group" key={date}>
                <h3>{date}</h3>
                <ul className="slot-list trainer-slot-list">
                  {daySlots.map((slot) => {
                    const hasAppointment = slot.appointmentId !== null
                    const assignedClient = clients.find((client) => client.id === slot.clientId)
                    const clientName =
                      slot.clientUsername ?? slot.legacyClientName ?? 'Χωρίς όνομα'

                    return (
                      <li
                        className="slot-card trainer-slot-card"
                        key={slot.id}
                        onTouchCancel={() => {
                          swipeStart.current = null
                        }}
                        onTouchEnd={finishSwipe}
                        onTouchStart={(event) =>
                          startSwipe(
                            event,
                            hasAppointment
                              ? { kind: 'cancel-appointment', slot }
                              : { kind: 'delete-slot', slot },
                          )
                        }
                      >
                        <strong className="trainer-slot-time">{formatTime(slot.startsAt)}</strong>
                        {hasAppointment && activeSection === 'trainer-appointments' ? (
                          <ClientBadge slot={slot} variant="person" />
                        ) : (
                        <span className={hasAppointment
                          ? 'trainer-booking-status is-booked'
                          : 'trainer-booking-status'}
                        >
                          {hasAppointment ? (
                            <span>Κλεισμένη · {clientName}</span>
                          ) : (
                            <>
                              <svg aria-hidden="true" viewBox="0 0 20 20">
                                <path d="m4 10 4 4 8-8" />
                              </svg>
                              <span>Ελεύθερη</span>
                            </>
                          )}
                          {assignedClient && !assignedClient.isActive && (
                            <span>Ανενεργός λογαριασμός</span>
                          )}
                        </span>
                        )}
                        <div className="trainer-slot-controls">
                          {hasAppointment && slot.appointmentId && (
                            <>
                              <button
                                aria-label={`Επεξεργασία ραντεβού ${formatDate(slot.startsAt)} ${formatTime(slot.startsAt)}`}
                                className="trainer-icon-button"
                                disabled={pendingAction !== null}
                                onClick={() => setActiveSheet({ kind: 'edit-appointment', slot })}
                                type="button"
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24">
                                  <path d="m14 5 5 5M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                                </svg>
                              </button>
                              {activeSection === 'trainer-appointments' && (
                                <button
                                  aria-label={`Ακύρωση ραντεβού ${formatDate(slot.startsAt)} ${formatTime(slot.startsAt)}`}
                                  className="trainer-icon-button is-destructive"
                                  disabled={pendingAction !== null}
                                  onClick={() => setActiveSheet({ kind: 'cancel-appointment', slot })}
                                  type="button"
                                >
                                  <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="M5 5l14 14M19 5 5 19" />
                                  </svg>
                                </button>
                              )}
                              {activeSection === 'trainer-hours' && (
                                <button
                                  aria-label={`Διαγραφή ώρας και ραντεβού ${formatDate(slot.startsAt)} ${formatTime(slot.startsAt)}`}
                                  className="trainer-icon-button is-destructive"
                                  disabled={pendingAction !== null}
                                  onClick={() => setActiveSheet({ kind: 'delete-slot', slot })}
                                  type="button"
                                >
                                  <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
                                  </svg>
                                </button>
                              )}
                            </>
                          )}
                          {activeSection === 'trainer-hours' && !hasAppointment && (
                            <button
                              aria-label={`Διαγραφή ώρας ${formatDate(slot.startsAt)} ${formatTime(slot.startsAt)}`}
                              className="trainer-icon-button is-destructive"
                              disabled={pendingAction !== null}
                              onClick={() => setActiveSheet({ kind: 'delete-slot', slot })}
                              type="button"
                            >
                              <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {!isLoading && pastDisplayedSlots.length > 0 && (
          <details className="trainer-past-section">
            <summary>
              Παλαιότερα ({pastDisplayedSlots.length})
            </summary>
            {pastDayGroups.map(({ date, slots: daySlots }) => (
              <section className="trainer-day-group" key={date}>
                <h3>{date}</h3>
                <ul className="slot-list trainer-slot-list">
                  {daySlots.map((slot) => (
                    <li className="slot-card trainer-slot-card is-past" key={slot.id}>
                      <strong className="trainer-slot-time">{formatTime(slot.startsAt)}</strong>
                      {isBooked(slot) ? (
                        <ClientBadge
                          slot={slot}
                          variant={activeSection === 'trainer-appointments' ? 'person' : 'status'}
                        />
                      ) : (
                        <span className="trainer-booking-status">
                          <span>Δεν κλείστηκε</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
        )}
      </section>
      )}

      {activeSection === 'trainer-clients' && (
      <section className="trainer-panel" aria-labelledby="trainer-clients-title">
        <div className="section-heading trainer-schedule-heading">
          <h2 id="trainer-clients-title">Ασκούμενοι</h2>
          <span className="availability-label">{activeAccountsLabel(activeClients.length)}</span>
        </div>

        <button
          aria-label="Νέος ασκούμενος"
          className="trainer-add-slot-fab"
          onClick={() => {
            setError('')
            setActiveSheet({ kind: 'new-client' })
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        {clients.length >= 20 && (
          <label className="client-search">
            <input
              aria-label="Αναζήτηση ασκούμενου"
              autoComplete="off"
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder="Αναζήτηση ασκούμενου"
              type="search"
              value={clientSearch}
            />
          </label>
        )}

        {isLoading ? (
          <p className="empty-state" role="status">Φορτώνουμε τους λογαριασμούς…</p>
        ) : clients.length === 0 ? (
          <p className="empty-state">Δεν υπάρχουν ακόμη λογαριασμοί ασκούμενων.</p>
        ) : visibleClients.length === 0 ? (
          <p className="empty-state">Δεν βρέθηκε ασκούμενος με αυτό το όνομα.</p>
        ) : (
          <ul className="slot-list">
            {visibleClients.map((client) => (
              <li
                className={
                  client.isActive
                    ? 'slot-card trainer-client-card trainer-client-compact'
                    : 'slot-card trainer-client-card trainer-client-compact is-inactive'
                }
                key={client.id}
              >
                <div className="slot-date">
                  <strong>
                    {client.username}
                    {!client.isActive && <span className="inactive-badge">Ανενεργός</span>}
                  </strong>
                  <span>
                    {upcomingAppointmentsCount(client.upcomingAppointmentCount)}
                    {client.mustChangePassword && ' · Δεν έχει συνδεθεί ακόμη'}
                  </span>
                </div>
                <button
                  aria-label={`Ενέργειες για ${client.username}`}
                  className="trainer-icon-button client-more-button"
                  disabled={pendingAction !== null}
                  onClick={() => {
                    setError('')
                    setActiveSheet({ kind: 'client-actions', client })
                  }}
                  type="button"
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
      <BottomSheet
        description={
          activeSheet?.kind === 'add-slot'
            ? 'Διάλεξε ημέρα και ώρα για τη νέα προπόνηση.'
            : activeSheet?.kind === 'edit-appointment'
            ? `${formatDayAndMonth(activeSheet.slot.startsAt)} · ${formatTime(activeSheet.slot.startsAt)}`
            : activeSheet?.kind === 'cancel-appointment'
              ? `Το ραντεβού με ${activeSheet.slot.clientUsername ?? activeSheet.slot.legacyClientName ?? 'τον ασκούμενο'} θα ακυρωθεί.`
              : activeSheet?.kind === 'delete-slot'
                ? activeSheet.slot.appointmentId
                  ? `Θα διαγραφεί η ώρα ${formatTime(activeSheet.slot.startsAt)} και θα ακυρωθεί το ραντεβού του ${activeSheet.slot.clientUsername ?? activeSheet.slot.legacyClientName ?? 'ασκούμενου'}.`
                  : 'Η ώρα θα αφαιρεθεί από το πρόγραμμά σου.'
                : activeSheet?.kind === 'new-client'
                  ? 'Θα δημιουργηθεί προσωρινός κωδικός που θα δώσεις στον ασκούμενο.'
                  : activeSheet?.kind === 'client-actions'
                    ? 'Τι θέλεις να κάνεις με αυτόν τον λογαριασμό;'
                    : activeSheet?.kind === 'deactivate-client'
                      ? 'Δεν θα μπορεί να συνδεθεί, αλλά τα δεδομένα του μένουν.'
                      : activeSheet?.kind === 'reset-password'
                        ? `Θα δημιουργηθεί νέος προσωρινός κωδικός για ${activeSheet.client.username}. Ο παλιός θα σταματήσει να ισχύει.`
                        : activeSheet?.kind === 'delete-client'
                          ? deleteClientWarning(
                              activeSheet.client.username,
                              activeSheet.client.upcomingAppointmentCount,
                            )
                          : undefined
        }
        onClose={closeSheet}
        open={activeSheet !== null}
        split={activeSheet?.kind === 'add-slot'}
        title={
          activeSheet?.kind === 'add-slot'
            ? 'Πρόσθεσε ώρα'
            : activeSheet?.kind === 'edit-appointment'
            ? 'Επεξεργασία ραντεβού'
            : activeSheet?.kind === 'cancel-appointment'
              ? 'Ακύρωση ραντεβού'
              : activeSheet?.kind === 'delete-slot'
                  ? `Να διαγραφεί η ώρα ${formatTime(activeSheet.slot.startsAt)};`
                : activeSheet?.kind === 'new-client'
                  ? 'Νέος ασκούμενος'
                  : activeSheet?.kind === 'client-actions'
                    ? activeSheet.client.username
                    : activeSheet?.kind === 'deactivate-client'
                      ? 'Απενεργοποίηση λογαριασμού'
                      : activeSheet?.kind === 'reset-password'
                        ? 'Νέος προσωρινός κωδικός'
                        : 'Διαγραφή λογαριασμού'
        }
      >
        {error && activeSheet?.kind !== 'edit-appointment' && (
          <p className="notice notice-error" role="alert">{error}</p>
        )}
        {activeSheet?.kind === 'add-slot' && (
          <AddSlotForm
            existingStarts={slots.map((slot) => slot.startsAt)}
            isPending={pendingAction === 'add-slot'}
            onSubmit={(startsAtList) => void addSlots(startsAtList)}
          />
        )}
        {activeSheet?.kind === 'edit-appointment' && activeSheet.slot.appointmentId && (
          <EditAppointmentForm
            appointment={activeSheet.slot}
            clients={clients}
            error={error}
            isPending={pendingAction === `save-appointment-${activeSheet.slot.appointmentId}`}
            now={now}
            onSubmit={(changes) => void saveAppointment(activeSheet.slot, changes)}
            slots={slots}
          />
        )}
        {activeSheet?.kind === 'cancel-appointment' && (
          <div className="bottom-sheet-actions">
            <button
              className="cancel-button bottom-sheet-destructive"
              disabled={pendingAction !== null}
              onClick={() => void cancelAppointment(activeSheet.slot)}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, ακύρωσε το ραντεβού"
                loading={pendingAction === `cancel-appointment-${activeSheet.slot.appointmentId}`}
                loadingText="Ακυρώνουμε…"
              />
            </button>
            <button className="cancel-button" onClick={() => setActiveSheet(null)} type="button">
              Διατήρηση ραντεβού
            </button>
          </div>
        )}
        {activeSheet?.kind === 'delete-slot' && (
          <div className="bottom-sheet-actions">
            <button
              className="cancel-button bottom-sheet-destructive"
              disabled={pendingAction !== null}
              onClick={() => void deleteSlot(activeSheet.slot)}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, διέγραψε την ώρα"
                loading={pendingAction === `delete-slot-${activeSheet.slot.id}`}
                loadingText="Διαγράφουμε…"
              />
            </button>
            <button className="cancel-button" onClick={() => setActiveSheet(null)} type="button">
              Διατήρηση ώρας
            </button>
          </div>
        )}
        {activeSheet?.kind === 'new-client' && (
          <form className="new-client-form" onSubmit={(event) => void createClient(event)}>
            <label className="name-field">
              <span>Όνομα χρήστη</span>
              <input
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                maxLength={32}
                minLength={3}
                onChange={(event) => setNewClientUsername(event.target.value)}
                required
                spellCheck={false}
                title="3–32 χαρακτήρες: λατινικά γράμματα, αριθμοί, τελεία, παύλα ή κάτω παύλα."
                value={newClientUsername}
              />
            </label>
            <button
              aria-busy={pendingAction === 'create-client'}
              className="book-button"
              disabled={pendingAction !== null}
              type="submit"
            >
              <ButtonFeedback
                idleText="Δημιουργία λογαριασμού"
                loading={pendingAction === 'create-client'}
                loadingText="Δημιουργούμε…"
              />
            </button>
          </form>
        )}
        {activeSheet?.kind === 'client-actions' && (
          <div className="client-action-list">
            {activeSheet.client.isActive ? (
              <button
                className="client-action"
                onClick={() => setActiveSheet({ kind: 'deactivate-client', client: activeSheet.client })}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 3v9m6.4-5.4a8 8 0 1 1-12.8 0" />
                </svg>
                <span>
                  <strong>Απενεργοποίηση λογαριασμού</strong>
                  <small>Δεν θα μπορεί να συνδεθεί, αλλά τα δεδομένα του μένουν.</small>
                </span>
              </button>
            ) : (
              <button
                className="client-action"
                disabled={pendingAction !== null}
                onClick={() => void setClientActive(activeSheet.client, true)}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 3v9m6.4-5.4a8 8 0 1 1-12.8 0" />
                </svg>
                <span>
                  <strong>Ενεργοποίηση λογαριασμού</strong>
                  <small>Θα μπορεί ξανά να συνδεθεί.</small>
                </span>
              </button>
            )}
            <button
              className="client-action"
              onClick={() => setActiveSheet({ kind: 'reset-password', client: activeSheet.client })}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="8" cy="15" r="4" />
                <path d="m11 12 9-9m-3 3 3 3m-6 0 3 3" />
              </svg>
              <span>
                <strong>Νέος προσωρινός κωδικός</strong>
              </span>
            </button>
            <button
              className="client-action is-destructive"
              onClick={() => setActiveSheet({ kind: 'delete-client', client: activeSheet.client })}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
              </svg>
              <span>
                <strong>Διαγραφή λογαριασμού</strong>
              </span>
            </button>
          </div>
        )}
        {activeSheet?.kind === 'deactivate-client' && (
          <div className="bottom-sheet-actions">
            <button
              className="book-button bottom-sheet-primary"
              disabled={pendingAction !== null}
              onClick={() => void setClientActive(activeSheet.client, false)}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, απενεργοποίηση"
                loading={pendingAction === `toggle-client-${activeSheet.client.id}`}
                loadingText="Απενεργοποιούμε…"
              />
            </button>
            <button className="cancel-button" onClick={() => setActiveSheet(null)} type="button">
              Ακύρωση
            </button>
          </div>
        )}
        {activeSheet?.kind === 'reset-password' && (
          <div className="bottom-sheet-actions">
            <button
              className="book-button bottom-sheet-primary"
              disabled={pendingAction !== null}
              onClick={() => void resetClientPassword(activeSheet.client)}
              type="button"
            >
              <ButtonFeedback
                idleText="Δημιουργία προσωρινού κωδικού"
                loading={pendingAction === `reset-password-${activeSheet.client.id}`}
                loadingText="Δημιουργούμε…"
              />
            </button>
            <button className="cancel-button" onClick={() => setActiveSheet(null)} type="button">
              Ακύρωση
            </button>
          </div>
        )}
        {activeSheet?.kind === 'delete-client' && (
          <div className="bottom-sheet-actions">
            <button
              className="cancel-button bottom-sheet-destructive"
              disabled={pendingAction !== null}
              onClick={() => void deleteClient(activeSheet.client)}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, διέγραψε τον λογαριασμό"
                loading={pendingAction === `delete-client-${activeSheet.client.id}`}
                loadingText="Διαγράφουμε…"
              />
            </button>
            <button className="cancel-button" onClick={() => setActiveSheet(null)} type="button">
              Διατήρηση λογαριασμού
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
