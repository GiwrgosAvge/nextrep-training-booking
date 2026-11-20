import { useMemo, useState, type UIEvent } from 'react'
import { ButtonFeedback } from './ButtonFeedback'
import {
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  addHoursLabel,
  addPickedTime,
  checkPickedTime,
  pad,
  pickedTimeMessages,
  toDate,
  toDayKey,
  toTimeKey,
  type PickedTimeProblem,
} from './slotPicker'

const DAYS_AHEAD = 28
const FIRST_HOUR = 8
const LAST_HOUR = 22
const STRIP_PADDING = 20

const presetTimes = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, index) => `${pad(FIRST_HOUR + index)}:00`,
)

const monthFormat = new Intl.DateTimeFormat('el-GR', { month: 'long', year: 'numeric' })

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="field-icon" focusable="false" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="18" x="3" y="5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="field-icon" focusable="false" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function AddSlotForm({
  existingStarts,
  isPending,
  onSubmit,
}: {
  existingStarts: string[]
  isPending: boolean
  onSubmit: (startsAt: string[]) => void
}) {
  const [day, setDay] = useState<string | null>(null)
  const [times, setTimes] = useState<string[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [hour, setHour] = useState('')
  const [minute, setMinute] = useState('')
  const [pickerProblem, setPickerProblem] = useState<PickedTimeProblem | null>(null)
  const [firstVisibleDay, setFirstVisibleDay] = useState(0)

  const [now] = useState(() => Date.now())

  const days = useMemo(() => {
    const today = new Date(now)
    return Array.from({ length: DAYS_AHEAD }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index, 12)
      return { key: toDayKey(date), date }
    })
  }, [now])

  const takenTimes = useMemo(() => {
    const taken = new Set<string>()
    for (const startsAt of existingStarts) {
      const date = new Date(startsAt)
      if (day !== null && toDayKey(date) === day) {
        taken.add(toTimeKey(date))
      }
    }
    return taken
  }, [existingStarts, day])

  const isPast = (time: string) => day !== null && toDate(day, time).getTime() <= now
  const gridTimes = [...new Set([...presetTimes, ...times])].sort()

  function selectDay(nextDay: string) {
    setDay(nextDay)
    setTimes([])
    closePicker()
  }

  function closePicker() {
    setShowPicker(false)
    setHour('')
    setMinute('')
    setPickerProblem(null)
  }

  function toggleTime(time: string) {
    setTimes((current) =>
      current.includes(time) ? current.filter((item) => item !== time) : addPickedTime(current, time),
    )
  }

  function addPickedToList() {
    if (day === null) {
      return
    }
    const result = checkPickedTime(day, hour, minute, now, takenTimes, times)
    if (result.problem !== null) {
      setPickerProblem(result.problem)
      return
    }
    setTimes((current) => addPickedTime(current, result.time))
    closePicker()
  }

  function updateVisibleMonth(event: UIEvent<HTMLDivElement>) {
    const strip = event.currentTarget
    const chips = Array.from(strip.children) as HTMLElement[]
    const index = chips.findIndex(
      (chip) => chip.offsetLeft + chip.offsetWidth / 2 > strip.scrollLeft + STRIP_PADDING,
    )
    setFirstVisibleDay(Math.max(0, index))
  }

  const monthLabel = monthFormat.format(days[firstVisibleDay]?.date ?? days[0].date)
  const canSubmit = day !== null && times.length > 0

  return (
    <form
      className="trainer-slot-sheet-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (day === null || times.length === 0) {
          return
        }
        onSubmit(times.map((time) => toDate(day, time).toISOString()))
      }}
    >
      <div className="slot-sheet-body">
        <div className="slot-picker-group">
          <span className="slot-picker-label">
            <CalendarIcon /> Διάλεξε μέρα
          </span>
          <span aria-live="polite" className="slot-picker-month">{monthLabel}</span>
          <div
            aria-label="Διάλεξε μέρα"
            className="day-strip slot-day-strip"
            onScroll={updateVisibleMonth}
            role="group"
          >
            {days.map(({ key, date }) => (
              <button
                aria-pressed={day === key}
                className="day-chip"
                key={key}
                onClick={() => selectDay(key)}
                type="button"
              >
                <span>{new Intl.DateTimeFormat('el-GR', { weekday: 'short' }).format(date)}</span>
                <strong>{date.getDate()}</strong>
                <span>{new Intl.DateTimeFormat('el-GR', { month: 'short' }).format(date)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="slot-picker-group">
          <span className="slot-picker-label">
            <ClockIcon /> Διάλεξε ώρες
          </span>
          {day === null ? (
            <p className="slot-picker-hint">Διάλεξε πρώτα μέρα για να δεις τις ώρες.</p>
          ) : (
            <div aria-label="Διάλεξε ώρες" className="time-chips" role="group">
              {gridTimes.map((time) => {
                const unavailable = isPast(time) || takenTimes.has(time)
                return (
                  <button
                    aria-pressed={times.includes(time)}
                    className="time-chip"
                    disabled={unavailable}
                    key={time}
                    onClick={() => toggleTime(time)}
                    title={
                      takenTimes.has(time)
                        ? 'Υπάρχει ήδη διαθέσιμη ώρα'
                        : isPast(time)
                          ? 'Η ώρα έχει περάσει'
                          : undefined
                    }
                    type="button"
                  >
                    {time}
                  </button>
                )
              })}
              <button
                aria-expanded={showPicker}
                className="time-chip time-chip-other"
                onClick={() => (showPicker ? closePicker() : setShowPicker(true))}
                type="button"
              >
                Άλλη ώρα
              </button>
            </div>
          )}
          {day !== null && showPicker && (
            <div className="time-picker">
              <div className="time-picker-selects">
                <label className="time-picker-field">
                  <span>Ώρα</span>
                  <select
                    onChange={(event) => {
                      setHour(event.target.value)
                      setPickerProblem(null)
                    }}
                    value={hour}
                  >
                    <option value="">--</option>
                    {HOUR_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="time-picker-field">
                  <span>Λεπτά</span>
                  <select
                    onChange={(event) => {
                      setMinute(event.target.value)
                      setPickerProblem(null)
                    }}
                    value={minute}
                  >
                    <option value="">--</option>
                    {MINUTE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="time-chip time-picker-add"
                disabled={hour === '' || minute === ''}
                onClick={addPickedToList}
                type="button"
              >
                Πρόσθεσε στη λίστα
              </button>
              {pickerProblem && (
                <p className="notice notice-error" role="alert">
                  {pickedTimeMessages[pickerProblem]}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="slot-sheet-footer">
        <button
          aria-busy={isPending}
          className="book-button bottom-sheet-primary"
          disabled={isPending || !canSubmit}
          type="submit"
        >
          <ButtonFeedback
            idleText={times.length > 0 ? addHoursLabel(times.length) : 'Πρόσθεσε ώρες'}
            loading={isPending}
            loadingText="Προσθέτουμε…"
          />
        </button>
        {day !== null && times.length === 0 && (
          <p className="slot-picker-hint slot-footer-hint">Διάλεξε τουλάχιστον μία ώρα</p>
        )}
      </div>
    </form>
  )
}
