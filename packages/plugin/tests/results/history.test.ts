import { expect, test } from 'vitest'
import { perUnitHistory } from '../../src/results/history.js'

const at = (hours: number) => new Date(Date.UTC(2026, 9, 30) + hours * 3_600_000)

test('one value per unit, anchored at its earliest event even with unsorted rows', () => {
  const events = [
    { unitId: 'a', value: 4, ts: at(2) },
    { unitId: 'b', value: 6, ts: at(7) },
    { unitId: 'a', value: 2, ts: at(1) },
    { unitId: 'b', value: 3, ts: at(6) },
  ]
  expect(perUnitHistory(events, { windowHours: 2 })).toEqual([6, 9])
  expect(events[0]!.ts).toEqual(at(2))
})

test('window end is exclusive and later events never open another window', () => {
  expect(perUnitHistory([
    { unitId: 'a', value: 2, ts: at(1) },
    { unitId: 'a', value: 3, ts: at(2) },
    { unitId: 'a', value: 100, ts: at(3) },
    { unitId: 'a', value: 200, ts: at(10) },
    { unitId: 'a', value: 300, ts: at(11) },
    { unitId: 'b', value: 7, ts: at(10) },
  ], { windowHours: 2 })).toEqual([5, 7])
})

test('zero-valued history units still contribute one value', () => {
  expect(perUnitHistory([{ unitId: 'a', value: 0, ts: at(1) }], { windowHours: 2 })).toEqual([0])
})

test('empty input', () => {
  expect(perUnitHistory([], { windowHours: 2 })).toEqual([])
})
