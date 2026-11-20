import { useMemo, useState } from 'react'
import { athensDay, athensTime, findSameDayAppointment, isPastStart } from './appointmentTime'
import { ButtonFeedback } from './ButtonFeedback'

interface EditableSlot {
  id: string
  startsAt: string
  appointmentId: string | null
  clientId: string | null
}

interface EditableClient {
  id: string
  username: string
  isActive: boolean
}

const dayLabelFormat = new Intl.DateTimeFormat('el-GR', {
  timeZone: 'Europe/Athens',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function EditAppointmentForm({
  appointment,
  slots,
  clients,
  now,
  isPending,
  error,
  onSubmit,
}: {
  appointment: EditableSlot
  slots: EditableSlot[]
  clients: EditableClient[]
  now: number
  isPending: boolean
  error: string
  onSubmit: (changes: { clientId?: string; slotId?: string }) => void
}) {
  const originalClientId = appointment.clientId ?? ''
  const [clientId, setClientId] = useState(originalClientId)
  const [slotId, setSlotId] = useState(appointment.id)

  const clientOptions = useMemo(() => {
    const active = clients.filter((client) => client.isActive)
    const current = clients.find((client) => client.id === originalClientId && !client.isActive)
    return current ? [current, ...active] : active
  }, [clients, originalClientId])

  const dayGroups = useMemo(() => {
    const selectable = slots
      .filter(
        (slot) =>
          slot.id === appointment.id ||
          (slot.appointmentId === null && !isPastStart(slot.startsAt, now)),
      )
      .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt))
    const groups = new Map<string, { label: string; slots: EditableSlot[] }>()
    for (const slot of selectable) {
      const key = athensDay(slot.startsAt)
      const group = groups.get(key) ?? {
        label: dayLabelFormat.format(new Date(slot.startsAt)),
        slots: [],
      }
      group.slots.push(slot)
      groups.set(key, group)
    }
    return [...groups.entries()]
  }, [slots, appointment.id, now])

  const selectedSlot = slots.find((slot) => slot.id === slotId)
  const selectedClient = clients.find((client) => client.id === clientId)
  const conflict =
    selectedSlot && clientId
      ? findSameDayAppointment(slots, clientId, selectedSlot.startsAt, appointment.appointmentId)
      : undefined
  const hasChanges = clientId !== originalClientId || slotId !== appointment.id
  const canSave = hasChanges && clientId !== '' && !conflict && !isPending

  function save() {
    onSubmit({
      ...(clientId !== originalClientId ? { clientId } : {}),
      ...(slotId !== appointment.id ? { slotId } : {}),
    })
  }

  return (
    <div className="edit-appointment-form">
      <label className="bottom-sheet-field">
        <span>Ασκούμενος</span>
        <select
          disabled={isPending}
          onChange={(event) => setClientId(event.target.value)}
          value={clientId}
        >
          {originalClientId === '' && (
            <option disabled value="">
              Διάλεξε ασκούμενο
            </option>
          )}
          {clientOptions.map((client) => (
            <option disabled={!client.isActive} key={client.id} value={client.id}>
              {client.username}
              {client.isActive ? '' : ' (ανενεργός)'}
            </option>
          ))}
        </select>
      </label>

      <label className="bottom-sheet-field">
        <span>Ώρα ραντεβού</span>
        <select
          aria-describedby={conflict ? 'edit-appointment-conflict' : undefined}
          disabled={isPending}
          onChange={(event) => setSlotId(event.target.value)}
          value={slotId}
        >
          {dayGroups.map(([key, group]) => (
            <optgroup key={key} label={group.label}>
              {group.slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {athensTime(slot.startsAt)}
                  {slot.id === appointment.id ? ' (τρέχουσα)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {conflict && selectedClient && (
        <p className="field-hint is-warning" id="edit-appointment-conflict" role="status">
          Ο {selectedClient.username} έχει ήδη ραντεβού στις {athensTime(conflict.startsAt)} εκείνη
          τη μέρα.
        </p>
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <button
        aria-busy={isPending}
        className="book-button bottom-sheet-primary"
        disabled={!canSave}
        onClick={save}
        type="button"
      >
        <ButtonFeedback idleText="Αποθήκευση αλλαγών" loading={isPending} loadingText="Αποθήκευση…" />
      </button>
    </div>
  )
}
