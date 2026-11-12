import { expect, test } from 'vitest'
import type { Snapshot } from '../../../src/types/snapshot.js'
import T1 from '../../_fixtures/snapshots/T1.json'
import T2 from '../../_fixtures/snapshots/T2.json'
import T3 from '../../_fixtures/snapshots/T3.json'
import T4 from '../../_fixtures/snapshots/T4.json'
import T7 from '../../_fixtures/snapshots/T7.json'
import { decideState } from '../../../src/testSurface/actions/decide.model.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'

const arms = [{ key: 'control' }, { key: 'variantA' }, { key: 'holdout' }]
const state = (snapshot: Snapshot | null, chosenArm: string | null = 'variantA', note = '', typed = '') => decideState({ snapshot, arms, chosenArm, note, typed })
test('prefills recommendation, labels options and excludes holdout', () => {
  const result = state(T7 as unknown as Snapshot)
  expect(result.prefill).toBe(T7.verdict.recommendedArm)
  expect(result.options).toEqual([{ value: 'control', label: 'Original' }, { value: 'variantA', label: 'Variant A' }])
  expect(result.guarded).toBe(false)
  expect(result.canSubmit).toBe(true)
  expect(result.body).toEqual({ winnerArm: 'variantA' })
  expect(state(T7 as unknown as Snapshot, 'holdout').canSubmit).toBe(false)
})
test('no results, no recommendation, and a different choice explain the guard', () => {
  expect(state(null).reason).toBe('There are no results yet.')
  expect(state(null).prefill).toBeNull()
  expect(state({ ...T7, verdict: { ...T7.verdict, recommendedArm: null } } as unknown as Snapshot).reason).toBe("The results don't recommend a group yet.")
  expect(state(T7 as unknown as Snapshot, 'control').reason).toBe('You chose a different group than the results recommend.')
})
test.each([T1, T2, T3, T4])('row $verdict.row is guarded', fixture => {
  const snapshot = fixture as unknown as Snapshot
  const result = state(snapshot, snapshot.verdict.recommendedArm)
  expect(result.guarded).toBe(true)
  expect(state(snapshot, 'variantA').reason).toBe(snapshot.verdict.headline)
  expect(state(snapshot, 'control').reason).toBe(snapshot.verdict.headline)
  expect(state(snapshot, null).reason).toBeNull()
  expect(state(snapshot, null).canSubmit).toBe(false)
})
test('guard requires nonblank note and shared exact phrase after trim', () => {
  const phrase = expectedConfirm('decide', 'Variant A')
  expect(state(null, 'variantA', 'reason', phrase.toLowerCase()).canSubmit).toBe(false)
  expect(state(null, 'variantA', '  ', phrase).canSubmit).toBe(false)
  expect(state(null, null, 'reason', phrase).canSubmit).toBe(false)
  expect(state(null, 'variantA', ' reason ', ` ${phrase} `)).toMatchObject({
    canSubmit: true, body: { winnerArm: 'variantA', note: 'reason', confirmation: phrase },
  })
})

test.each([null, T1, T2, T3, T4, T7])('no group chosen has no reason and cannot submit', fixture => {
  expect(state(fixture as unknown as Snapshot | null, null)).toMatchObject({ reason: null, canSubmit: false })
})
test('stored labels are trimmed for options and confirmation, with fixed-name fallback', () => {
  const renamed = [{ key: 'control', label: '  ' }, { key: 'variantA', label: ' Short headline ' }]
  const result = decideState({ snapshot: null, arms: renamed, chosenArm: 'variantA', note: 'Reviewed', typed: ' Short headline ' })
  expect(result.options).toEqual([{ value: 'control', label: 'Original' }, { value: 'variantA', label: 'Short headline' }])
  expect(result.phrase).toBe(expectedConfirm('decide', 'Short headline'))
  expect(result.canSubmit).toBe(true)
  expect(result.body.confirmation).toBe('Short headline')
})
