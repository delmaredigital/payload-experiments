'use client'

import { useContext } from 'react'
import type { DocId } from '../types/contracts.js'
import { sendExposure, warnOnce } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function useFlagPoint<P extends Record<string, unknown> = Record<string, unknown>>(id: string): { arm: string; params: P; source: 'experiment' | 'default'; experiment?: string; experimentId?: DocId; expose(renderedArm: string): void } {
  const value = useContext(ExperimentsContext)
  const entry = value && Object.hasOwn(value.flagPoints, id) ? value.flagPoints[id] : undefined
  if (!entry) {
    const message = `Flag point "${id}" must be allow-listed in toClientAssignments and rendered inside ExperimentsProvider.`
    if (process.env.NODE_ENV !== 'production') throw new Error(message)
    warnOnce(`flagPoint:${id}`, message)
  }
  return {
    arm: entry?.arm ?? 'control', params: (entry?.params ?? {}) as P, source: entry?.source ?? 'default',
    ...(entry?.source === 'experiment' ? { experiment: entry.experiment, experimentId: entry.experimentId } : {}),
    expose(renderedArm) {
      if (!value || !entry?.exposable || entry.source !== 'experiment' || entry.policy !== 'manual' ||
        entry.experiment === undefined || entry.phase === undefined) return
      sendExposure(value.apiRoute, {
        type: 'exposure', experiment: entry.experiment, phase: entry.phase, arm: renderedArm, policy: entry.policy,
      })
    },
  }
}
