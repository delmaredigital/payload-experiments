'use client'
import { useEffect } from 'react'
import type { DocId } from '../../types/contracts.js'
import { SAVE_PAGE, PUBLISH_PAGE } from '../../testSurface/surface/editorPlacement.js'
import { watchPlacementNotice } from './placementsCache.js'

/** No timer for readiness, read errors, or resolved placements. */
export function usePlacementNotice(api: string, id: DocId | undefined, message: string | undefined) {
  const showing = message === SAVE_PAGE || message === PUBLISH_PAGE
  useEffect(() => {
    if (id === undefined || !showing) return
    return watchPlacementNotice(api, id, document)
  }, [api, id, showing])
}
