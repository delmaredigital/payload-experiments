'use client'
import type { ReadinessParts } from '../contracts.js'
import { SaveStatus } from './SaveStatus.js'
import { sectionDone } from './readiness.model.js'

export const readinessParts: ReadinessParts = { SaveStatus, sectionDone }
