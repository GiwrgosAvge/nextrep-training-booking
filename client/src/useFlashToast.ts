import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readFlashToast, withoutFlashToast } from './flashToast'

export function useFlashToast() {
  const location = useLocation()
  const navigate = useNavigate()
  const [toast, setToast] = useState(() => readFlashToast(location.state))

  useEffect(() => {
    const remainingState = withoutFlashToast(location.state)
    if (remainingState === location.state) {
      return
    }

    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: remainingState },
    )
  }, [location, navigate])

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  return [toast, setToast] as const
}
