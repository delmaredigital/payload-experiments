'use client'
import { useEffect } from 'react'
import type { DocId } from '../../types/contracts.js'
import { watchPlacementNotice } from './placementsCache.js'

/** Subscribe only while save/publish guidance or a retryable placement failure is visible. */
export function usePlacementNotice(api: string, id: DocId | undefined, message: string | undefined) {
  const showing = message !== undefined && id !== undefined
  useEffect(() => {
    if (id === undefined || !showing) return
    return watchPlacementNotice(api, id, document)
  }, [api, id, showing])
}
