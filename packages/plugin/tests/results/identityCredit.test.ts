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
    { anonymousId: 'same-arm', userId: 'u', verifiedAt: null, ownedAt: null },
    { anonymousId: 'earlier', userId: 'u', verifiedAt: null, ownedAt: null },
    { anonymousId: 'earlier', userId: 'u', verifiedAt: null, ownedAt: null },
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
  expect(creditUserEvents(units, [{ anonymousId: 'unexposed', userId: 'u', verifiedAt: null, ownedAt: null }], [
    { userId: 'u', value: 5, ts: at(4) },
    { userId: 'unknown', value: 7, ts: at(5) },
  ])).toEqual({ events: [], conflicts: 0 })
})

test('cross-arm conflicts count users once and exclude nobody', () => {
  const identities = ['u', 'v'].flatMap(userId => [
    { anonymousId: 'later', userId, verifiedAt: null, ownedAt: null },
    { anonymousId: 'earlier', userId, verifiedAt: null, ownedAt: null },
    { anonymousId: 'later', userId, verifiedAt: null, ownedAt: null },
  ])
  expect(creditUserEvents(units, identities, [{ userId: 'u', value: 5, ts: at(4) }]))
    .toEqual({ events: [{ unitId: 'earlier', value: 5, ts: at(4) }], conflicts: 1 })
})

test('credit preserves pre-exposure events for the aggregation window to drop', () => {
  expect(creditUserEvents(units, [{ anonymousId: 'earlier', userId: 'u', verifiedAt: null, ownedAt: null }], [
    { userId: 'u', value: 5, ts: at(0) },
  ]).events).toEqual([{ unitId: 'earlier', value: 5, ts: at(0) }])
})

test('simultaneous exposures use a stable anonymous-id tie-break', () => {
  const tied = new Map([
    ['b', { arm: 'control', firstTs: at(1) }],
    ['a', { arm: 'control', firstTs: at(1) }],
  ])
  const identities = [{ anonymousId: 'b', userId: 'u', verifiedAt: null, ownedAt: null }, { anonymousId: 'a', userId: 'u', verifiedAt: null, ownedAt: null }]
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
    { anonymousId: 'later', userId: 'u', verifiedAt: null, ownedAt: null }, { anonymousId: 'earlier', userId: 'u', verifiedAt: null, ownedAt: null },
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

const browsers = new Map([
  ['A', { arm: 'control', firstTs: at(0) }],
  ['B', { arm: 'variantA', firstTs: at(1) }],
])
const link = (anonymousId: string, verifiedAt: Date | null, ownedAt: Date | null) => ({ anonymousId, userId: 'owner', verifiedAt, ownedAt })
const activity = (hours: number, value = 1) => ({ userId: 'owner', ts: at(hours), value })

test('same-browser registration then verification retains all activity on A', () => {
  expect(creditUserEvents(browsers, [link('A', at(2), at(2))], [activity(1), activity(3)]).events.map(e => e.unitId)).toEqual(['A', 'A'])
})

test('attack: registration stays on X, victim activity at and after proof goes to Y', () => {
  const result = creditUserEvents(browsers, [link('A', null, at(2)), link('B', at(2), at(2))], [activity(1), activity(2, 100), activity(3, 200)])
  expect(result.events.map(e => [e.unitId, e.value])).toEqual([['A', 1], ['B', 100], ['B', 200]])
  expect(result.conflicts).toBe(1)
})

test('cross-device: A drops after unexposed B proves ownership; proving sign-in on A restores credit', () => {
  const onlyA = new Map([['A', browsers.get('A')!]])
  expect(creditUserEvents(onlyA, [link('A', null, at(2))], [activity(1), activity(2), activity(3)]).events.map(e => e.unitId)).toEqual(['A'])
  expect(creditUserEvents(onlyA, [link('A', at(4), at(2))], [activity(4), activity(5)]).events.map(e => e.unitId)).toEqual(['A', 'A'])
})

test('never-verified account credits an offline gift months after registration without a time window', () => {
  expect(creditUserEvents(browsers, [link('A', null, null)], [activity(24 * 365, 500)]).events).toEqual([{ unitId: 'A', value: 500, ts: at(24 * 365) }])
})

test('two verified browsers always retain the earliest exposure tie-break', () => {
  expect(creditUserEvents(browsers, [link('B', at(2), at(2)), link('A', at(3), at(2))], [activity(4)]).events[0]!.unitId).toBe('A')
})

test('different account on a linked browser gets no credit without its own link', () => {
  expect(creditUserEvents(browsers, [link('A', at(2), at(2))], [{ userId: 'other', value: 100, ts: at(3) }])).toEqual({ events: [], conflicts: 0 })
})

test('conflict counts each user once only for events with eligible cross-arm links', () => {
  const links = [link('A', null, at(2)), link('B', at(2), at(2))]
  expect(creditUserEvents(browsers, links, [activity(2), activity(3)]).conflicts).toBe(0)
  expect(creditUserEvents(browsers, links, [activity(1), activity(1.5), activity(3)]).conflicts).toBe(1)
})
