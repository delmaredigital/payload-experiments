import { hash, layerSlice, rolloutBucketRanges } from '@delmaredigital/experiments-stats'

/** Spec §7.6/§8.1.5 (X1): first-ever rollout exposures inside assignment's exact ranges. */
export function rolloutAnalysisUnits({ exposuresAllPhases, rolloutPhase, seed, testWeights, coverage, layer }: {
  exposuresAllPhases: readonly { unitId: string; phase: number; ts: Date }[]
  rolloutPhase: number
  seed: string
  testWeights: readonly number[]
  coverage: number
  layer?: { slug: string; slices: readonly number[] }
}): Set<string> {
  const first = new Map<string, { phase: number; ts: Date }>()
  for (const row of exposuresAllPhases) {
    const previous = first.get(row.unitId)
    // Phase numbers increase chronologically; prefer the older phase on a timestamp tie.
    if (!previous || row.ts.getTime() < previous.ts.getTime()
      || (row.ts.getTime() === previous.ts.getTime() && row.phase < previous.phase)) {
      first.set(row.unitId, { phase: row.phase, ts: row.ts })
    }
  }
  const { winner, holdout } = rolloutBucketRanges(testWeights, coverage)
  const units = new Set<string>()
  for (const [unitId, exposure] of first) {
    if (exposure.phase !== rolloutPhase) continue
    if (layer && !layer.slices.includes(layerSlice(layer.slug, unitId))) continue
    const bucket = hash(seed, unitId, 2)!
    if ((bucket >= winner[0] && bucket < winner[1])
      || (bucket >= holdout[0] && bucket < holdout[1])) units.add(unitId)
  }
  return units
}
