import { expect, test } from 'vitest'
import { perUnitHistory } from '../../src/results/history.js'

const at = (hours: number) => new Date(Date.UTC(2026, 9, 30) + hours * 3_600_000)

test('sorts each unit chronologically without mutating the caller rows', () => {
  const events = [
    { unitId: 'a', value: 4, ts: at(2) },
    { unitId: 'b', value: 6, ts: at(7) },
    { unitId: 'a', value: 2, ts: at(1) },
    { unitId: 'b', value: 3, ts: at(6) },
  ]
  expect(perUnitHistory(events, { windowHours: 2 })).toEqual({ values: [6, 9], units: 2 })
  expect(events[0]!.ts).toEqual(at(2))
})

test('repeat donors contribute several values; an event exactly at the end opens the next window', () => {
  expect(perUnitHistory([
    { unitId: 'a', value: 2, ts: at(1) },
    { unitId: 'a', value: 3, ts: at(2) },
    { unitId: 'a', value: 100, ts: at(3) },
    { unitId: 'a', value: 200, ts: at(10) },
    { unitId: 'a', value: 300, ts: at(11) },
    { unitId: 'b', value: 7, ts: at(10) },
  ], { windowHours: 2 })).toEqual({ values: [5, 100, 500, 7], units: 2 })
})

test('window starts are inclusive, even with duplicate timestamps and unsorted repeat events', () => {
  expect(perUnitHistory([
    { unitId: 'a', value: 7, ts: at(4) },
    { unitId: 'a', value: 3, ts: at(1) },
    { unitId: 'a', value: 5, ts: at(3) },
    { unitId: 'a', value: 2, ts: at(1) },
  ], { windowHours: 2 })).toEqual({ values: [5, 12], units: 1 })
})

test('zero-valued windows are kept and a unit with a single event contributes one value', () => {
  expect(perUnitHistory([
    { unitId: 'a', value: 0, ts: at(1) },
    { unitId: 'a', value: 0, ts: at(3) },
    { unitId: 'b', value: 9, ts: at(1) },
  ], { windowHours: 2 })).toEqual({ values: [0, 0, 9], units: 2 })
})

test('twenty windows from one unit still count as only one history unit', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ unitId: 'a', value: 1, ts: at(i * 2) }))
  expect(perUnitHistory(events, { windowHours: 2 })).toEqual({ values: Array(20).fill(1), units: 1 })
})

test('accepts mixed Date, timestamp text and epoch millisecond inputs', () => {
  expect(perUnitHistory([
    { unitId: 'a', value: 7, ts: at(3).getTime() },
    { unitId: 'a', value: 2, ts: '2026-10-30 01:00:00+00' },
    { unitId: 'a', value: 3, ts: at(2) },
  ], { windowHours: 2 })).toEqual({ values: [5, 7], units: 1 })
})

test.each([0, -1, NaN, Infinity, -Infinity, undefined, null, '2'])(
  'rejects invalid windowHours %s even with no events', windowHours => {
    expect(() => perUnitHistory([], { windowHours: windowHours as number })).toThrow(RangeError)
  },
)

test.each([new Date(NaN), 'invalid', NaN, Infinity, 8.64e15 + 1])('rejects invalid event timestamp %s', ts => {
  expect(() => perUnitHistory([{ unitId: 'a', value: 1, ts }], { windowHours: 2 })).toThrow(RangeError)
})

test('empty input', () => {
  expect(perUnitHistory([], { windowHours: 2 })).toEqual({ values: [], units: 0 })
})
