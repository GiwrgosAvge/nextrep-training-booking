interface ButtonFeedbackProps {
  loading: boolean
  loadingText: string
  idleText: string
}

export function ButtonFeedback({
  loading,
  loadingText,
  idleText,
}: ButtonFeedbackProps) {
  return (
    <span className="button-feedback" aria-live={loading ? 'polite' : undefined}>
      {loading && <span className="button-spinner" aria-hidden="true" />}
      <span>{loading ? loadingText : idleText}</span>
    </span>
  )
}
