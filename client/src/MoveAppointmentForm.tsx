import { useState } from 'react'
import { ButtonFeedback } from './ButtonFeedback'
import { athensTime } from './appointmentTime'

interface MoveOption {
  id: string
  startsAt: string
  localDay: string
}

interface MoveAppointment {
  startsAt: string
}

const zone = 'Europe/Athens'

function formatDayLabel(startsAt: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startsAt))
}

// Το localDay είναι ήδη ημερομηνία Ελλάδας: το μορφοποιούμε σε UTC ώστε να μη μετακινηθεί.
function formatLocalDay(localDay: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('el-GR', { ...options, timeZone: 'UTC' }).format(
    new Date(`${localDay}T12:00:00Z`),
  )
}

export function MoveAppointmentForm({
  appointment,
  options,
  isPending,
  error,
  onSelectionChange,
  onSubmit,
}: {
  appointment: MoveAppointment
  options: MoveOption[]
  isPending: boolean
  error: string
  onSelectionChange: () => void
  onSubmit: (slotId: string) => void
}) {
  // Καμία προεπιλογή: ο ασκούμενος διαλέγει ρητά μέρα και ώρα.
  const [dayChoice, setDayChoice] = useState<string | null>(null)
  const [slotChoice, setSlotChoice] = useState<string | null>(null)

  const days = [...new Set(options.map((option) => option.localDay))]
  const day = dayChoice !== null && days.includes(dayChoice) ? dayChoice : null
  const daySlots = options.filter((option) => option.localDay === day)
  const selected = daySlots.find((option) => option.id === slotChoice) ?? null

  function chooseDay(nextDay: string) {
    setDayChoice(nextDay)
    setSlotChoice(null)
    onSelectionChange()
  }

  function chooseSlot(slotId: string) {
    setSlotChoice(slotId)
    onSelectionChange()
  }

  return (
    <form
      className="move-appointment-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (selected !== null && !isPending) {
          onSubmit(selected.id)
        }
      }}
    >
      <div className="move-summary">
        <p>
          Τώρα: {formatDayLabel(appointment.startsAt)} · {athensTime(appointment.startsAt)}
        </p>
        {selected && (
          <p className="move-summary-new" role="status">
            Νέα ώρα: {formatDayLabel(selected.startsAt)} · {athensTime(selected.startsAt)}
          </p>
        )}
      </div>

      {options.length === 0 ? (
        <p className="slot-picker-hint">Δεν υπάρχουν διαθέσιμες ώρες αυτή τη στιγμή.</p>
      ) : (
        <>
          <div aria-label="Διάλεξε μέρα" className="day-strip slot-day-strip" role="group">
            {days.map((optionDay) => (
              <button
                aria-label={formatLocalDay(optionDay, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
                aria-pressed={optionDay === day}
                className="day-chip"
                key={optionDay}
                onClick={() => chooseDay(optionDay)}
                type="button"
              >
                <span>{formatLocalDay(optionDay, { weekday: 'short' })}</span>
                <strong>{formatLocalDay(optionDay, { day: 'numeric' })}</strong>
                <span>{formatLocalDay(optionDay, { month: 'short' })}</span>
              </button>
            ))}
          </div>
          {day === null ? (
            <p className="slot-picker-hint">Διάλεξε πρώτα μέρα για να δεις τις ώρες.</p>
          ) : (
            <div aria-label="Διάλεξε ώρα" className="time-chips" role="group">
              {daySlots.map((option) => (
                <button
                  aria-pressed={option.id === selected?.id}
                  className="time-chip"
                  key={option.id}
                  onClick={() => chooseSlot(option.id)}
                  type="button"
                >
                  {athensTime(option.startsAt)}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button
        aria-busy={isPending}
        className="book-button bottom-sheet-primary"
        disabled={selected === null || isPending}
        type="submit"
      >
        <ButtonFeedback
          idleText="Επιβεβαίωση αλλαγής"
          loading={isPending}
          loadingText="Αλλάζουμε την ώρα…"
        />
      </button>
    </form>
  )
}
