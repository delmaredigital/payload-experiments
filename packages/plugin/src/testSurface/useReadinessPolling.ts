'use client'
import { useEffect, useRef } from 'react'
import type { ReadinessRead } from './readinessRead.js'

/** Non-shared reads use the same visible-only delay policy as editor cache reads. */
export function useReadinessPolling(read: ReadinessRead | undefined, refresh: () => void, enabled = true, pending = false) {
  const action = useRef(refresh)
  action.current = refresh
  useEffect(() => {
    if (!enabled || pending || !read?.pollDelay) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = setTimeout(() => action.current(), read.pollDelay!)
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule) }
  }, [read, enabled, pending])
}
