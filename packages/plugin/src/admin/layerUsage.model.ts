import type { Status } from '../types/contracts.js'

export type LayerExperiment = { name: string; status: Status; layerSlices?: readonly number[] | null }
export function layerUsage(experiments: readonly LayerExperiment[]) {
  const slices = new Set<number>()
  // ADM-08 coordinator ruling (spec §5.3): exp-core clears layerSlices to [] when freeing slices.
  const rows = experiments.filter(doc => doc.status === 'running' || doc.status === 'decided').map(doc => {
    const unique = new Set(doc.layerSlices ?? [])
    unique.forEach(slice => slices.add(slice))
    return { name: doc.name, status: doc.status, slices: unique.size }
  })
  return { used: slices.size, free: 100 - slices.size, rows }
}
