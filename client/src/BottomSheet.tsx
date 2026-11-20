import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

interface BottomSheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  // «split»: το περιεχόμενο χειρίζεται μόνο του το scroll και το κάτω κουμπί μένει σταθερό.
  split?: boolean
  children: ReactNode
}

const focusableSelector =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
const CLOSE_DRAG_DISTANCE = 90

export function BottomSheet({
  open,
  title,
  description,
  onClose,
  split = false,
  children,
}: BottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const dragStartY = useRef<number | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal()
      // Εστίαση στον τίτλο, όχι στο κουμπί «Χ» (το showModal θα εστίαζε στο πρώτο κουμπί).
      titleRef.current?.focus({ preventScroll: true })
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onClose])

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
    // Focus trap: ο χρήστης κυκλώνει μόνο μέσα στο sheet.
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (!first || !last) {
      event.preventDefault()
      return
    }
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    dragStartY.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const dialog = dialogRef.current
    if (dragStartY.current === null || !dialog) {
      return
    }
    const distance = Math.max(0, event.clientY - dragStartY.current)
    dialog.style.animation = 'none'
    dialog.style.transform = `translateY(${distance}px)`
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const dialog = dialogRef.current
    const start = dragStartY.current
    dragStartY.current = null
    if (!dialog || start === null) {
      return
    }
    const distance = event.clientY - start
    dialog.style.animation = ''
    dialog.style.transform = ''
    if (distance >= CLOSE_DRAG_DISTANCE) {
      onClose()
    }
  }

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className="bottom-sheet"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="bottom-sheet-drag-zone"
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <div className="bottom-sheet-handle" />
      </div>
      <header className="bottom-sheet-header">
        <div>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button
          aria-label="Κλείσιμο"
          className="bottom-sheet-close"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className={split ? 'bottom-sheet-content is-split' : 'bottom-sheet-content'}>
        {children}
      </div>
    </dialog>
  )
}
