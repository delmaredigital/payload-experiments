'use client'
// XP-PLACEHOLDER: ADM-23 supplies the readiness banner, save status and section state.
import type { ReadinessParts, SectionId } from '../contracts.js'

const none = (): Record<SectionId, boolean> => ({ what: false, versions: false, win: false, who: true, length: false, advanced: true })
export const readinessParts: ReadinessParts = { Banner: () => null, SaveStatus: () => null, sectionDone: none }
