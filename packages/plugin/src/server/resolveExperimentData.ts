import type { Data } from '@puckeditor/core'
import type { Assignments, RenderedExposure } from '../types/assignments.js'
import { manifestOf, suppressExposure } from './context.js'

export function resolveExperimentData<TData extends Data>(puckData: TData, assignments: Assignments): { data: TData; rendered: RenderedExposure[] } {
  const rendered = new Map<string, RenderedExposure>()
  const slots = ['control', 'variantA', 'variantB', 'variantC']
  const manifest = manifestOf(assignments)
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.type !== 'ExperimentSlot') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]))
    const props = node.props && typeof node.props === 'object' ? node.props as Record<string, unknown> : {}
    // Stored Puck JSON is untrusted, including unbound and unknown experiments.
    const clean = { ...props }
    delete clean.xpSlot
    delete clean.xpArm
    delete clean.xpExpose
    const ref = props.experiment as { slug?: unknown } | null | undefined
    const slug = typeof ref?.slug === 'string' ? ref.slug : undefined
    const assignment = slug && Object.hasOwn(assignments.bySlug, slug) ? assignments.bySlug[slug] : undefined
    const experiment = manifest?.experiments.find(e => e.slug === slug)
    const arm = experiment?.arms.find(a => a.key === assignment?.arm)
    const archived = slug && Object.hasOwn(assignments.archivedWinners, slug) ? assignments.archivedWinners[slug] : undefined
    const selected = assignment ? (assignment.arm === 'holdout' ? 'control' : arm?.slot ?? assignment.arm) : archived ?? 'control'
    const slot = slots.includes(selected) ? selected : 'control'
    clean.xpSlot = slot
    if (assignment) {
      clean.xpArm = assignment.arm
      if (assignment.exposable && !suppressExposure(assignments)) {
        const exposure = { slug: assignment.slug, arm: assignment.arm, phase: assignment.phase }
        // A missing slot has rendered no experimental content.
        if (Array.isArray(props[slot])) {
          if (assignment.policy === 'render') rendered.set(`${assignment.slug}|${assignment.phase}|${assignment.arm}`, exposure)
          if (assignment.policy === 'viewport') clean.xpExpose = exposure
        }
      }
    }
    for (const name of slots) clean[name] = name === slot ? walk(props[name] ?? []) : []
    for (const [key, item] of Object.entries(clean)) if (!slots.includes(key)) clean[key] = walk(item)
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === 'props' ? clean : walk(item)]))
  }
  return { data: walk(puckData) as TData, rendered: [...rendered.values()] }
}
