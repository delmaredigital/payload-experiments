'use client'

import { useContext } from 'react'
import { sendExposure, warnOnce } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function useExperiment<P extends Record<string, unknown> = Record<string, unknown>>(slug: string): { arm: string; params: P; expose(renderedArm: string): void } {
  const value = useContext(ExperimentsContext)
  const entry = value && Object.hasOwn(value.experiments, slug) ? value.experiments[slug] : undefined
  if (!entry) {
    const message = `Experiment "${slug}" must be allow-listed in toClientAssignments and rendered inside ExperimentsProvider.`
    if (process.env.NODE_ENV !== 'production') throw new Error(message)
    warnOnce(`experiment:${slug}`, message)
  }
  return {
    arm: entry?.arm ?? 'control', params: (entry?.params ?? {}) as P,
    expose(renderedArm) {
      if (!value || !entry?.exposable || entry.policy !== 'manual') return
      sendExposure(value.apiRoute, {
        type: 'exposure', experiment: slug, phase: entry.phase, arm: renderedArm, policy: entry.policy,
      })
    },
  }
}
