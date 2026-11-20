import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'
import { BottomSheet } from './BottomSheet'
import { useFlashToast } from './useFlashToast'
import { ButtonFeedback } from './ButtonFeedback'
import { MoveAppointmentForm } from './MoveAppointmentForm'
import {
  freeHoursCount,
  isPastStart,
  partitionByTime,
  cancelQuestion,
  compactAppointmentLabel,
  relativeAppointmentLabel,
  shortAppointmentDate,
  upcomingAppointmentsCount,
} from './appointmentTime'

interface AvailableSlot {
  id: string
  startsAt: string
  localDay: string
  blockedReason: string | null
  blockingAppointmentId: string | null
}

interface Appointment {
  id: string
  slotId: string
  startsAt: string
  localDay: string
}

interface ClientData {
  slots: AvailableSlot[]
  appointments: Appointment[]
}

type ClientSection = 'available-hours' | 'my-bookings'
type ClientSheet =
  | { kind: 'move'; appointment: Appointment }
  | { kind: 'cancel'; appointment: Appointment }
  | null

class ClientRequestError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

const ALREADY_BOOKED_THAT_DAY = 'ALREADY_BOOKED_THAT_DAY'
const trainingTimeZone = 'Europe/Athens'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAvailableSlot(value: unknown): value is AvailableSlot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startsAt === 'string' &&
    typeof value.localDay === 'string' &&
    (typeof value.blockedReason === 'string' || value.blockedReason === null) &&
    (typeof value.blockingAppointmentId === 'string' || value.blockingAppointmentId === null)
  )
}

function isAppointment(value: unknown): value is Appointment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.slotId === 'string' &&
    typeof value.startsAt === 'string' &&
    typeof value.localDay === 'string'
  )
}

function formatDate(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: trainingTimeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(startsAt))
}

function formatTime(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: trainingTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(startsAt))
}

// Το localDay είναι ήδη ημερομηνία Ελλάδας, οπότε το μορφοποιούμε σε UTC για να μη μετακινηθεί.
function formatLocalDay(localDay: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('el-GR', { ...options, timeZone: 'UTC' }).format(
    new Date(`${localDay}T12:00:00Z`),
  )
}

// Ώρες όπου μπορεί να μετακινηθεί ένα ραντεβού: ελεύθερες και σε μέρα χωρίς άλλο ραντεβού.
function getMoveOptions(slots: AvailableSlot[], appointment: Appointment): AvailableSlot[] {
  return slots.filter(
    (slot) =>
      slot.blockingAppointmentId === null || slot.blockingAppointmentId === appointment.id,
  )
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="lock-icon" focusable="false" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="16" x="4" y="5" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="lock-icon" focusable="false" viewBox="0 0 24 24">
      <rect height="10" rx="2" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (response.status >= 500) {
      throw new ClientRequestError('Ο server δεν είναι διαθέσιμος αυτή τη στιγμή.')
    }
    throw new ClientRequestError('Ο server επέστρεψε απάντηση σε μη αναμενόμενη μορφή.')
  }
}

async function getResponseError(response: Response): Promise<ClientRequestError> {
  const data = await readJson(response)
  if (isRecord(data) && typeof data.error === 'string') {
    return new ClientRequestError(
      data.error,
      typeof data.code === 'string' ? data.code : undefined,
    )
  }
  return new ClientRequestError('Δεν ήταν δυνατή η ολοκλήρωση του αιτήματος.')
}

async function loadClientData(signal?: AbortSignal): Promise<ClientData> {
  const [slotsResponse, appointmentsResponse] = await Promise.all([
    fetch('/api/client/slots', { credentials: 'include', signal }),
    fetch('/api/client/appointments', { credentials: 'include', signal }),
  ])

  if (!slotsResponse.ok) {
    throw await getResponseError(slotsResponse)
  }
  if (!appointmentsResponse.ok) {
    throw await getResponseError(appointmentsResponse)
  }

  const slotsData: unknown = await readJson(slotsResponse)
  const appointmentsData: unknown = await readJson(appointmentsResponse)
  if (
    !isRecord(slotsData) ||
    !Array.isArray(slotsData.slots) ||
    !slotsData.slots.every(isAvailableSlot) ||
    !isRecord(appointmentsData) ||
    !Array.isArray(appointmentsData.appointments) ||
    !appointmentsData.appointments.every(isAppointment)
  ) {
    throw new ClientRequestError('Ο server επέστρεψε πρόγραμμα σε μη αναμενόμενη μορφή.')
  }

  return { slots: slotsData.slots, appointments: appointmentsData.appointments }
}

async function sendBookingRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  slotId?: string,
): Promise<void> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    ...(slotId
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotId }),
        }
      : {}),
  })
  if (!response.ok) {
    throw await getResponseError(response)
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

export function ClientDashboard({
  activeSection,
  navigateToSection,
  registerNoticeReset,
}: {
  activeSection: ClientSection
  navigateToSection?: (section: ClientSection) => void
  registerNoticeReset: (reset: () => void) => () => void
}) {
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [showAllLater, setShowAllLater] = useState(false)
  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [toast, setToast] = useFlashToast()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeSheet, setActiveSheet] = useState<ClientSheet>(null)
  const [conflictMessage, setConflictMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const pullDistanceRef = useRef(0)
  const pullStartY = useRef<number | null>(null)
  const swipeStart = useRef<{ x: number; y: number; appointment: Appointment } | null>(null)
  const appointments = clientData?.appointments ?? []
  const { upcoming: upcomingAppointments, past: pastAppointments } = partitionByTime(appointments, now)
  const slots = (clientData?.slots ?? []).filter((slot) => !isPastStart(slot.startsAt, now))
  const freeSlotCount = slots.filter((slot) => slot.blockedReason === null).length
  const bookedByDay = new Map(appointments.map((appointment) => [appointment.localDay, appointment]))
  const days = [...new Set(slots.map((slot) => slot.localDay))]
  const activeDay = selectedDay !== null && days.includes(selectedDay) ? selectedDay : (days[0] ?? null)
  const daySlots = slots.filter((slot) => slot.localDay === activeDay)
  const dayAppointment = activeDay === null ? undefined : bookedByDay.get(activeDay)
  const allDayLocked =
    dayAppointment !== undefined &&
    daySlots.length > 0 &&
    daySlots.every((slot) => slot.blockedReason !== null)
  const isLoading = clientData === null && error === ''

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

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
      const data = await loadClientData(signal)
      setClientData(data)
      setNow(Date.now())
      setError('')
    } catch (caughtError) {
      if (!(caughtError instanceof DOMException && caughtError.name === 'AbortError')) {
        setError(getErrorMessage(caughtError, 'Δεν ήταν δυνατή η φόρτωση του προγράμματος.'))
      }
      throw caughtError
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let isMounted = true
    void loadClientData(controller.signal)
      .then((data) => {
        if (isMounted) {
          setClientData(data)
        }
      })
      .catch((caughtError: unknown) => {
        if (
          isMounted &&
          !(caughtError instanceof DOMException && caughtError.name === 'AbortError')
        ) {
          console.error(caughtError)
          setError(getErrorMessage(caughtError, 'Δεν ήταν δυνατή η φόρτωση του προγράμματος.'))
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
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refresh])

  async function performBooking(slotId: string, appointmentId?: string) {
    setPendingId(appointmentId ?? slotId)
    setError('')
    setMessage('')
    try {
      await sendBookingRequest(
        appointmentId
          ? `/api/client/appointments/${appointmentId}`
          : '/api/client/appointments',
        appointmentId ? 'PATCH' : 'POST',
        slotId,
      )
      if (appointmentId) {
        setToast('Η ώρα άλλαξε')
      } else {
        setMessage('Η κράτηση ολοκληρώθηκε.')
      }
      setActiveSheet(null)
      await refresh()
    } catch (caughtError) {
      const isMove = appointmentId !== undefined
      // Στην αλλαγή ώρας το sheet μένει ανοιχτό και δείχνει το μήνυμα κοντά στο κουμπί.
      if (!isMove) {
        setActiveSheet(null)
      }
      if (
        !isMove &&
        caughtError instanceof ClientRequestError &&
        caughtError.code === ALREADY_BOOKED_THAT_DAY
      ) {
        setConflictMessage(caughtError.message)
      } else {
        setError(getErrorMessage(caughtError, 'Δεν ήταν δυνατή η αλλαγή της ώρας.'))
      }
      try {
        await refresh()
      } catch (refreshError) {
        console.error(refreshError)
      }
    } finally {
      setPendingId(null)
    }
  }

  function openMoveSheet(appointment: Appointment) {
    setError('')
    setActiveSheet({ kind: 'move', appointment })
  }

  function renderAppointmentControls(appointment: Appointment, compact = false) {
    return (
      <div className={compact ? 'appointment-controls is-compact' : 'appointment-controls'}>
        <button
          className={compact ? 'outline-button' : 'book-button'}
          disabled={getMoveOptions(slots, appointment).length === 0 || pendingId !== null}
          onClick={() => openMoveSheet(appointment)}
          type="button"
        >
          Άλλαξε ώρα
        </button>
        <button
          className="cancel-button"
          disabled={pendingId !== null}
          onClick={() => setActiveSheet({ kind: 'cancel', appointment })}
          type="button"
        >
          Ακύρωση
        </button>
      </div>
    )
  }

  async function cancelAppointment(appointment: Appointment) {
    setPendingId(appointment.id)
    setError('')
    setMessage('')
    try {
      await sendBookingRequest(`/api/client/appointments/${appointment.id}`, 'DELETE')
      setToast('Το ραντεβού ακυρώθηκε')
      setActiveSheet(null)
      // Μικρή παύση για να φύγει ομαλά η κάρτα πριν ανανεωθεί η λίστα.
      setLeavingId(appointment.id)
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      await refresh()
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Δεν ήταν δυνατή η ακύρωση.'))
      try {
        await refresh()
      } catch (refreshError) {
        console.error(refreshError)
      }
    } finally {
      setLeavingId(null)
      setPendingId(null)
    }
  }

  function onBookingsTouchStart(event: TouchEvent<HTMLElement>) {
    pullDistanceRef.current = 0
    const scrollContainer = event.currentTarget.closest<HTMLElement>('.dashboard-scroll-area')
    if (scrollContainer && scrollContainer.scrollTop <= 0 && event.touches.length === 1) {
      pullStartY.current = event.touches[0].clientY
    } else {
      pullStartY.current = null
    }
  }

  function onBookingsTouchMove(event: TouchEvent<HTMLElement>) {
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

  function onBookingsTouchEnd() {
    if (
      pullDistanceRef.current >= 64 &&
      !isRefreshing &&
      pendingId === null &&
      activeSheet === null
    ) {
      setError('')
      void refresh().catch((caughtError: unknown) =>
        setError(getErrorMessage(caughtError, 'Δεν ήταν δυνατή η ανανέωση.')),
      )
    }
    pullStartY.current = null
    pullDistanceRef.current = 0
    setPullDistance(0)
  }

  function startAppointmentSwipe(
    event: TouchEvent<HTMLElement>,
    appointment: Appointment,
  ) {
    if (event.target instanceof Element && event.target.closest('button, input, select, a')) {
      swipeStart.current = null
      return
    }
    swipeStart.current = {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
      appointment,
    }
  }

  function finishAppointmentSwipe(event: TouchEvent<HTMLElement>) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || pendingId !== null) {
      return
    }
    const deltaX = event.changedTouches[0].clientX - start.x
    const deltaY = event.changedTouches[0].clientY - start.y
    if (deltaX <= -90 && Math.abs(deltaY) < 50) {
      setActiveSheet({ kind: 'cancel', appointment: start.appointment })
    }
  }

  const moveAppointmentTarget = activeSheet?.kind === 'move' ? activeSheet.appointment : null
  const moveOptions = moveAppointmentTarget ? getMoveOptions(slots, moveAppointmentTarget) : []

  return (
    <div
      className="client-dashboard-content"
      onTouchCancel={() => {
        pullStartY.current = null
        pullDistanceRef.current = 0
        setPullDistance(0)
      }}
      onTouchEnd={onBookingsTouchEnd}
      onTouchMove={onBookingsTouchMove}
      onTouchStart={onBookingsTouchStart}
    >
      {toast && <p className="app-toast" role="status">{toast}</p>}
      {error && !activeSheet && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
      <p className="pull-refresh-hint" role="status" aria-live="polite">
        {isRefreshing
          ? 'Ανανεώνουμε το πρόγραμμά σου…'
          : pullDistance >= 64
            ? 'Άφησε για ανανέωση'
            : pullDistance > 20
              ? 'Τράβηξε προς τα κάτω για ανανέωση'
              : ''}
      </p>
      {activeSection === 'available-hours' && (
      <section className="booking-layout" aria-label="Διαθέσιμες ώρες">
        <div className="slots-panel">
          {!isLoading && slots.length > 0 && (
            <p className="screen-badge-row">
              <span className="availability-label">{freeHoursCount(freeSlotCount)}</span>
            </p>
          )}

          {isLoading ? (
            <p className="empty-state" role="status">Φορτώνουμε τις διαθέσιμες ώρες…</p>
          ) : slots.length === 0 && !error ? (
            <p className="empty-state">Δεν υπάρχουν ελεύθερες ώρες αυτή τη στιγμή.</p>
          ) : slots.length > 0 ? (
            <>
              <div aria-label="Διάλεξε μέρα" className="day-strip" role="group">
                {days.map((day) => {
                  const hasBooking = bookedByDay.has(day)
                  return (
                    <button
                      aria-label={`${formatLocalDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}${hasBooking ? ', έχεις ραντεβού' : ''}`}
                      aria-pressed={day === activeDay}
                      className="day-chip"
                      key={day}
                      onClick={() => setSelectedDay(day)}
                      type="button"
                    >
                      <span>{formatLocalDay(day, { weekday: 'short' })}</span>
                      <strong>{formatLocalDay(day, { day: 'numeric' })}</strong>
                      <span>{formatLocalDay(day, { month: 'short' })}</span>
                      <i aria-hidden="true" className={hasBooking ? 'day-dot is-booked' : 'day-dot'} />
                    </button>
                  )
                })}
              </div>
              {days.some((day) => bookedByDay.has(day)) && (
                <p className="day-legend">
                  <i aria-hidden="true" className="day-dot-inline" /> Έχεις ραντεβού
                </p>
              )}
              {activeDay && (
                <h3 className="day-heading">
                  {formatLocalDay(activeDay, { weekday: 'long', day: 'numeric', month: 'long' })}
                </h3>
              )}
              {dayAppointment && (
                <div className="day-booking-note" role="note">
                  <p>
                    <LockIcon />
                    {allDayLocked
                      ? `Έχεις ήδη ραντεβού στις ${formatTime(dayAppointment.startsAt)}. Για άλλη ώρα πάτα Άλλαξε ώρα.`
                      : `Έχεις ήδη ραντεβού στις ${formatTime(dayAppointment.startsAt)}`}
                  </p>
                  <button
                    className="cancel-button"
                    disabled={pendingId !== null}
                    onClick={() => openMoveSheet(dayAppointment)}
                    type="button"
                  >
                    Άλλαξε ώρα
                  </button>
                </div>
              )}
              <ul className="slot-list">
                {(allDayLocked ? [] : daySlots).map((slot) => {
                  const isBlocked = slot.blockedReason !== null
                  return (
                    <li
                      className={isBlocked ? 'slot-card is-locked' : 'slot-card'}
                      key={slot.id}
                    >
                      <div className="slot-date">
                        <strong>{formatTime(slot.startsAt)}</strong>
                        {isBlocked && (
                          <span className="locked-label">
                            <LockIcon /> Έχεις ήδη ραντεβού αυτή τη μέρα
                          </span>
                        )}
                      </div>
                      {!isBlocked && (
                        <button
                          aria-busy={pendingId === slot.id}
                          className="book-button"
                          disabled={pendingId !== null}
                          onClick={() => void performBooking(slot.id)}
                          type="button"
                        >
                          <ButtonFeedback
                            idleText="Κράτηση"
                            loading={pendingId === slot.id}
                            loadingText="Κλείνουμε…"
                          />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </div>
      </section>
      )}

      {activeSection === 'my-bookings' && (
      <section className="my-bookings" aria-label="Οι κρατήσεις μου">
        {!isLoading && (
          <p className="screen-badge-row">
            <span className="availability-label">
              {upcomingAppointmentsCount(upcomingAppointments.length)}
            </span>
          </p>
        )}
        <div
          className="bookings-touch-area"
        >
        {isLoading ? (
          <p className="empty-state" role="status">Φορτώνουμε τα ραντεβού…</p>
        ) : upcomingAppointments.length === 0 ? (
          <div className="empty-appointments" role="status">
            <CalendarIcon />
            <p>Δεν έχεις κλείσει προπόνηση</p>
            <button
              className="book-button"
              onClick={() => navigateToSection?.('available-hours')}
              type="button"
            >
              Κλείσε προπόνηση
            </button>
          </div>
        ) : (
          <>
            {upcomingAppointments.slice(0, 1).map((appointment) => (
              <article
                className={
                  leavingId === appointment.id
                    ? 'next-appointment-card is-leaving'
                    : 'next-appointment-card'
                }
                key={appointment.id}
                onTouchCancel={() => {
                  swipeStart.current = null
                }}
                onTouchEnd={finishAppointmentSwipe}
                onTouchStart={(event) => startAppointmentSwipe(event, appointment)}
              >
                <p className="next-appointment-eyebrow">Επόμενη προπόνηση</p>
                <p className="next-appointment-when">
                  <CalendarIcon />
                  <span>{relativeAppointmentLabel(appointment.startsAt, now)}</span>
                </p>
                <p className="next-appointment-date">{formatDate(appointment.startsAt)}</p>
                {renderAppointmentControls(appointment)}
              </article>
            ))}
            {upcomingAppointments.length > 1 && (
              <h2 className="later-title">Αργότερα</h2>
            )}
            {upcomingAppointments.length > 1 && (
              <ul className="slot-list later-list">
                {upcomingAppointments
                  .slice(1, showAllLater || upcomingAppointments.length <= 4 ? undefined : 4)
                  .map((appointment) => (
                  <li
                    className={
                      leavingId === appointment.id
                        ? 'slot-card appointment-card is-leaving'
                        : 'slot-card appointment-card'
                    }
                    key={appointment.id}
                    onTouchCancel={() => {
                      swipeStart.current = null
                    }}
                    onTouchEnd={finishAppointmentSwipe}
                    onTouchStart={(event) => startAppointmentSwipe(event, appointment)}
                  >
                    <div className="slot-date">
                      <strong>{compactAppointmentLabel(appointment.startsAt, now)}</strong>
                      <span>{shortAppointmentDate(appointment.startsAt, now)}</span>
                    </div>
                    {renderAppointmentControls(appointment, true)}
                  </li>
                ))}
              </ul>
            )}
            {upcomingAppointments.length > 4 && (
              <button
                className="show-all-button"
                onClick={() => setShowAllLater((current) => !current)}
                type="button"
              >
                {showAllLater ? 'Δες λιγότερα' : `Δες όλα (${upcomingAppointments.length - 1})`}
              </button>
            )}
          </>
        )}
        {!isLoading && pastAppointments.length > 0 && (
          <details className="trainer-past-section">
            <summary>Παλαιότερα ({pastAppointments.length})</summary>
            <ul className="slot-list">
              {pastAppointments.map((appointment) => (
                <li className="slot-card appointment-card is-past" key={appointment.id}>
                  <div className="slot-date">
                    <span>{formatDate(appointment.startsAt)}</span>
                    <strong>{formatTime(appointment.startsAt)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
        </div>
      </section>
      )}

      <BottomSheet
        description={
          activeSheet?.kind === 'cancel'
            ? 'Το ραντεβού θα ακυρωθεί και η ώρα θα γίνει διαθέσιμη.'
            : undefined
        }
        onClose={() => setActiveSheet(null)}
        open={activeSheet !== null}
        title={
          activeSheet?.kind === 'move'
            ? 'Άλλαξε ώρα'
            : activeSheet?.kind === 'cancel'
              ? cancelQuestion(activeSheet.appointment.startsAt, now)
              : 'Ακύρωση ραντεβού'
        }
      >
        {error && activeSheet?.kind !== 'move' && (
          <p className="notice notice-error" role="alert">{error}</p>
        )}
        {activeSheet?.kind === 'move' && (
          <MoveAppointmentForm
            appointment={activeSheet.appointment}
            error={error}
            isPending={pendingId === activeSheet.appointment.id}
            key={activeSheet.appointment.id}
            onSelectionChange={() => setError('')}
            onSubmit={(slotId) => void performBooking(slotId, activeSheet.appointment.id)}
            options={moveOptions}
          />
        )}
        {activeSheet?.kind === 'cancel' && (
          <div className="bottom-sheet-actions">
            <button
              className="cancel-button bottom-sheet-destructive"
              disabled={pendingId !== null}
              onClick={() => void cancelAppointment(activeSheet.appointment)}
              type="button"
            >
              <ButtonFeedback
                idleText="Ναι, ακύρωση"
                loading={pendingId === activeSheet.appointment.id}
                loadingText="Ακυρώνουμε…"
              />
            </button>
            <button
              className="book-button"
              disabled={pendingId !== null}
              onClick={() => setActiveSheet(null)}
              type="button"
            >
              Όχι, κράτησέ το
            </button>
          </div>
        )}
      </BottomSheet>
      <BottomSheet
        onClose={() => setConflictMessage('')}
        open={conflictMessage !== ''}
        title="Έχεις ήδη ραντεβού"
      >
        <p>{conflictMessage}</p>
        <p>Μπορείς να αλλάξεις την ώρα του ραντεβού σου ή να διαλέξεις άλλη μέρα.</p>
        <button
          className="book-button bottom-sheet-primary"
          onClick={() => setConflictMessage('')}
          type="button"
        >
          Εντάξει
        </button>
      </BottomSheet>
    </div>
  )
}
