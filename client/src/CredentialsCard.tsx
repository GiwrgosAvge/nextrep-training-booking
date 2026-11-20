import { useState } from 'react'

interface CredentialsCardProps {
  title: string
  username: string
  password: string
  onDone: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Σε http (π.χ. δοκιμή στο τοπικό δίκτυο) το Clipboard API δεν είναι διαθέσιμο.
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

function buildShareMessage(username: string, password: string, appUrl: string): string {
  return [
    'Γεια σου! Ο λογαριασμός σου στο NextRep είναι έτοιμος.',
    `Όνομα χρήστη: ${username}`,
    `Προσωρινός κωδικός: ${password}`,
    `Σύνδεση: ${appUrl}`,
    'Στην πρώτη σύνδεση θα διαλέξεις δικό σου κωδικό.',
    'Για να έχεις την εφαρμογή στην αρχική οθόνη: άνοιξέ την στον browser του κινητού και διάλεξε «Προσθήκη στην αρχική οθόνη».',
  ].join('\n')
}

export function CredentialsCard({ title, username, password, onDone }: CredentialsCardProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    setCopyState((await copyText(password)) ? 'copied' : 'failed')
    window.setTimeout(() => setCopyState('idle'), 2500)
  }

  async function share() {
    try {
      await navigator.share({ text: buildShareMessage(username, password, window.location.origin) })
    } catch (caughtError) {
      // Ο χρήστης μπορεί απλώς να κλείσει το παράθυρο κοινοποίησης.
      if (!(caughtError instanceof DOMException && caughtError.name === 'AbortError')) {
        console.error(caughtError)
      }
    }
  }

  return (
    <section aria-labelledby="credentials-title" className="credentials-card" role="status">
      <h3 id="credentials-title">{title}</h3>
      <dl className="credentials-fields">
        <div>
          <dt>Όνομα χρήστη</dt>
          <dd className="credentials-username">{username}</dd>
        </div>
        <div>
          <dt>Προσωρινός κωδικός</dt>
          <dd className="credentials-password">{password}</dd>
        </div>
      </dl>
      <p className="credentials-warning">Ο κωδικός φαίνεται μόνο τώρα. Αν τον χάσεις, φτιάξε νέο.</p>
      <div className={canShare ? 'credentials-actions has-share' : 'credentials-actions'}>
        <button onClick={() => void copy()} type="button">
          {copyState === 'copied'
            ? 'Αντιγράφηκε ✓'
            : copyState === 'failed'
              ? 'Δεν αντιγράφηκε'
              : 'Αντιγραφή'}
        </button>
        {canShare && (
          <button onClick={() => void share()} type="button">Μοιράσου</button>
        )}
      </div>
      {copyState === 'failed' && (
        <p className="credentials-warning" role="alert">
          Κράτα πατημένο τον κωδικό και αντίγραψέ τον χειροκίνητα.
        </p>
      )}
      <button className="credentials-done" onClick={onDone} type="button">Το αντέγραψα</button>
    </section>
  )
}
