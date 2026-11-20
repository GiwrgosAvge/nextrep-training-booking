export interface FlashState {
  toast: string
}

export function readFlashToast(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'toast' in state) {
    const toast = state.toast
    return typeof toast === 'string' ? toast : ''
  }
  return ''
}

export function withoutFlashToast(state: unknown): unknown {
  if (
    typeof state !== 'object' ||
    state === null ||
    Array.isArray(state) ||
    !('toast' in state) ||
    typeof state.toast !== 'string'
  ) {
    return state
  }
  const { toast: _toast, ...remainingState } = state
  return remainingState
}
