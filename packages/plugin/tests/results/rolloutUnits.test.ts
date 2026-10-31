import { hash, layerSlice, rolloutBucketRanges } from '@delmaredigital/experiments-stats'
import { expect, test } from 'vitest'
import { rolloutAnalysisUnits } from '../../src/results/rolloutUnits.js'

const seed = 'rollout-test|'
const testWeights = [5, 93, 2]
const coverage = 0.5
const at = (hours: number) => new Date(Date.UTC(2026, 9, 30) + hours * 3_600_000)
const args = { seed, testWeights, coverage, rolloutPhase: 2 }
const exposure = (unitId: string, phase = 2, hours = 2) => ({ unitId, phase, ts: at(hours) })

function findUnit(predicate: (bucket: number, unitId: string) => boolean): string {
  for (let i = 0; i < 200_000; i++) {
    const unitId = `unit-${i}`
    if (predicate(hash(seed, unitId, 2)!, unitId)) return unitId
  }
  throw new Error('No unit matching the test condition')
}

test('a first-ever rollout unit in the winner range is included', () => {
  const unit = findUnit(bucket => bucket < 0.4)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [exposure(unit)] })).toEqual(new Set([unit]))
})

test('a first-ever rollout unit in the holdout range is included', () => {
  const unit = findUnit(bucket => bucket > 0.98 && bucket < 0.99)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [exposure(unit)] })).toEqual(new Set([unit]))
})

test('units outside both ranges are excluded', () => {
  const gap = findUnit(bucket => bucket > 0.5 && bucket < 0.9)
  const beyond = findUnit(bucket => bucket > 0.995)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [exposure(gap), exposure(beyond)] })).toEqual(new Set())
})

test('an earlier test exposure excludes the unit even when rows arrive out of order', () => {
  const unit = findUnit(bucket => bucket < 0.4)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [
    exposure(unit), exposure(unit, 1, 1), exposure(unit, 2, 3),
  ] })).toEqual(new Set())
})

test('a later phase exposure does not replace the first rollout exposure', () => {
  const unit = findUnit(bucket => bucket < 0.4)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [exposure(unit, 3, 3), exposure(unit)] }))
    .toEqual(new Set([unit]))
})

test('layer membership uses the assignment layerSlice and excludes units outside the slices', () => {
  const unit = findUnit(bucket => bucket < 0.4)
  const slug = 'shared-layer'
  const slice = layerSlice(slug, unit)
  const exposuresAllPhases = [exposure(unit)]
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases, layer: { slug, slices: [slice] } }))
    .toEqual(new Set([unit]))
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases, layer: { slug, slices: [(slice + 1) % 100] } }))
    .toEqual(new Set())
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases, layer: { slug, slices: [] } })).toEqual(new Set())
})

test('X1 preserves the test weights and floating-point range boundaries at partial coverage', () => {
  const { winner, holdout } = rolloutBucketRanges(testWeights, coverage)
  expect(winner).toEqual([0, 0.49000000000000005])
  expect(holdout).toEqual([0.9800000000000001, 0.9900000000000001])
  const winnerEdge = findUnit(bucket => bucket === 0.49)
  const beforeHoldout = findUnit(bucket => bucket === 0.98)
  const afterHoldout = findUnit(bucket => bucket === 0.9901)
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [
    exposure(winnerEdge), exposure(beforeHoldout), exposure(afterHoldout),
  ] })).toEqual(new Set([winnerEdge]))
})

test('membership matches assignment rolloutBucketRanges with the test weights', () => {
  const exposuresAllPhases = Array.from({ length: 1000 }, (_, i) => exposure(`grid-${i}`))
  for (const coverage of [0, 0.5, 1]) {
    const ranges = rolloutBucketRanges(testWeights, coverage)
    const expected = exposuresAllPhases.filter(({ unitId }) => {
      const bucket = hash(seed, unitId, 2)!
      return Object.values(ranges).some(([start, end]) => bucket >= start && bucket < end)
    }).map(({ unitId }) => unitId)
    expect(rolloutAnalysisUnits({ ...args, coverage, exposuresAllPhases })).toEqual(new Set(expected))
  }
})

test('empty exposures', () => {
  expect(rolloutAnalysisUnits({ ...args, exposuresAllPhases: [] })).toEqual(new Set())
})
