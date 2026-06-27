import { useEffect, useState } from 'react'
import {
  type OpenCodeCliLimits,
  currentLimits,
  statusListeners,
} from './openCodeCliLimits.js'

export function useOpenCodeCliLimits(): OpenCodeCliLimits {
  const [limits, setLimits] = useState<OpenCodeCliLimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: OpenCodeCliLimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
