'use client'
import { useEffect } from 'react'
import type { DocId } from '../../types/contracts.js'
import { PLACEMENT_FAILURE_COPY, READINESS_COPY, SAVE_PAGE, PUBLISH_PAGE, RUNNING_SAVE_PAGE, RUNNING_PUBLISH_PAGE } from '../../testSurface/copy/readiness.js'
import { watchPlacementNotice } from './placementsCache.js'

/** Subscribe only while save/publish guidance or a retryable placement failure is visible. */
export function usePlacementNotice(api: string, id: DocId | undefined, message: string | undefined) {
  const showing = message === SAVE_PAGE || message === PUBLISH_PAGE || message === RUNNING_SAVE_PAGE || message === RUNNING_PUBLISH_PAGE || message === PLACEMENT_FAILURE_COPY['placements-failed'] || message === READINESS_COPY.checkError
  useEffect(() => {
    if (id === undefined || !showing) return
    return watchPlacementNotice(api, id, document)
  }, [api, id, showing])
}
