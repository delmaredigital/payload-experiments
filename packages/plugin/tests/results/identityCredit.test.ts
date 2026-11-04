import { XpAnalysisError } from '../../src/errors.js'
import { expect, test } from 'vitest'
import { creditUserEvents } from '../../src/results/identityCredit.js'

const at = (hours: number) => new Date(Date.UTC(2026, 9, 30) + hours * 3_600_000)
const units = new Map([
  ['later', { arm: 'variantA', firstTs: at(3) }],
  ['earlier', { arm: 'control', firstTs: at(1) }],
  ['same-arm', { arm: 'control', firstTs: at(2) }],
])

test('earliest exposed linked id wins; every event is credited once with its value and timestamp', () => {
  const identities = [
    { anonymousId: 'same-arm', userId: 'u' },
    { anonymousId: 'earlier', userId: 'u' },
    { anonymousId: 'earlier', userId: 'u' },
  ]
  expect(creditUserEvents(units, identities, [
    { userId: 'u', value: 5, ts: at(4) },
    { userId: 'u', value: 7, ts: at(5) },
  ])).toEqual({ events: [
    { unitId: 'earlier', value: 5, ts: at(4) },
    { unitId: 'earlier', value: 7, ts: at(5) },
  ], conflicts: 0 })
})

test('users without exposed linked ids are dropped', () => {
  expect(creditUserEvents(units, [{ anonymousId: 'unexposed', userId: 'u' }], [
    { userId: 'u', value: 5, ts: at(4) },
    { userId: 'unknown', value: 7, ts: at(5) },
  ])).toEqual({ events: [], conflicts: 0 })
})

test('cross-arm conflicts count users once and exclude nobody', () => {
  const identities = ['u', 'v'].flatMap(userId => [
    { anonymousId: 'later', userId },
    { anonymousId: 'earlier', userId },
    { anonymousId: 'later', userId },
  ])
  expect(creditUserEvents(units, identities, [{ userId: 'u', value: 5, ts: at(4) }]))
    .toEqual({ events: [{ unitId: 'earlier', value: 5, ts: at(4) }], conflicts: 2 })
})

test('credit preserves pre-exposure events for the aggregation window to drop', () => {
  expect(creditUserEvents(units, [{ anonymousId: 'earlier', userId: 'u' }], [
    { userId: 'u', value: 5, ts: at(0) },
  ]).events).toEqual([{ unitId: 'earlier', value: 5, ts: at(0) }])
})

test('simultaneous exposures use a stable anonymous-id tie-break', () => {
  const tied = new Map([
    ['b', { arm: 'control', firstTs: at(1) }],
    ['a', { arm: 'control', firstTs: at(1) }],
  ])
  const identities = [{ anonymousId: 'b', userId: 'u' }, { anonymousId: 'a', userId: 'u' }]
  const events = [{ userId: 'u', value: 1, ts: at(2) }]
  expect(creditUserEvents(tied, identities, events).events[0]!.unitId).toBe('a')
  expect(creditUserEvents(tied, [...identities].reverse(), events).events[0]!.unitId).toBe('a')
})

test('empty inputs', () => {
  expect(creditUserEvents(new Map(), [], [])).toEqual({ events: [], conflicts: 0 })
})

test('accepts timestamp text and epoch milliseconds when choosing the earliest linked id', () => {
  const mixed = new Map([
    ['later', { arm: 'variantA', firstTs: at(3).getTime() }],
    ['earlier', { arm: 'control', firstTs: '2026-10-30 01:00:00+00' }],
  ])
  expect(creditUserEvents(mixed, [
    { anonymousId: 'later', userId: 'u' }, { anonymousId: 'earlier', userId: 'u' },
  ], [{ userId: 'u', value: 5, ts: at(4).toISOString() }])).toEqual({
    events: [{ unitId: 'earlier', value: 5, ts: at(4).toISOString() }], conflicts: 1,
  })
})

test.each([new Date(NaN), 'invalid', NaN, Infinity, 8.64e15 + 1])('rejects invalid timestamps %s', ts => {
  expect(() => creditUserEvents(new Map([['a', { arm: 'control', firstTs: ts }]]), [], []))
    .toThrow(expect.objectContaining({ constructor: XpAnalysisError, code: 'invalid-timestamp' }))
  expect(() => creditUserEvents(new Map(), [], [{ userId: 'unexposed', value: 1, ts }]))
    .toThrow(expect.objectContaining({ constructor: XpAnalysisError, code: 'invalid-timestamp' }))
})
