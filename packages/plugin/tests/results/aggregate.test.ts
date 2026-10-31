import { describe, expect, test } from 'vitest'
import { firstExposures, perUnitValues } from '../../src/results/aggregate.js'

const at = (hours: number) => new Date(Date.UTC(2026, 9, 30) + hours * 3_600_000)

describe('firstExposures', () => {
  test('finds the earliest exposure without relying on input order', () => {
    const rows = [
      { unitId: 'a', arm: 'control', ts: at(4) },
      { unitId: 'b', arm: 'variantA', ts: at(2) },
      { unitId: 'a', arm: 'control', ts: at(1) },
    ]
    expect(firstExposures(rows)).toEqual({
      units: new Map([
        ['a', { arm: 'control', firstTs: at(1) }],
        ['b', { arm: 'variantA', firstTs: at(2) }],
      ]), excludedMultiArm: 0,
    })
    expect(rows[0]!.ts).toEqual(at(4))
  })

  test('excludes each multi-arm unit once, even after more rows for that unit', () => {
    const rows = [
      { unitId: 'a', arm: 'control', ts: at(1) },
      { unitId: 'a', arm: 'variantA', ts: at(2) },
      { unitId: 'a', arm: 'variantB', ts: at(3) },
      { unitId: 'a', arm: 'control', ts: at(4) },
      { unitId: 'b', arm: 'control', ts: at(1) },
      { unitId: 'b', arm: 'variantA', ts: at(2) },
    ]
    expect(firstExposures(rows)).toEqual({ units: new Map(), excludedMultiArm: 2 })
  })

  test('ignores exposures at and after endedAt before detecting multi-arm units', () => {
    expect(firstExposures([
      { unitId: 'a', arm: 'control', ts: at(1) },
      { unitId: 'a', arm: 'variantA', ts: at(2) },
      { unitId: 'b', arm: 'control', ts: at(2) },
      { unitId: 'c', arm: 'control', ts: at(3) },
    ], { endedAt: at(2) })).toEqual({
      units: new Map([['a', { arm: 'control', firstTs: at(1) }]]), excludedMultiArm: 0,
    })
  })

  test('empty input has no exposures or exclusions', () => {
    expect(firstExposures([])).toEqual({ units: new Map(), excludedMultiArm: 0 })
  })
})

describe('perUnitValues', () => {
  const units = new Map([
    ['a', { arm: 'control', firstTs: at(1) }],
    ['b', { arm: 'variantA', firstTs: at(3) }],
    ['c', { arm: 'control', firstTs: at(1) }],
  ])
  const events = [
    { unitId: 'a', value: 100, ts: at(0) }, // before exposure
    { unitId: 'a', value: 2, ts: at(1) }, // inclusive start
    { unitId: 'a', value: 3, ts: at(2) },
    { unitId: 'a', value: 200, ts: at(3) }, // exclusive end
    { unitId: 'b', value: 300, ts: at(2) }, // b's own exposure is later
    { unitId: 'unknown', value: 400, ts: at(2) },
  ]

  test.each([
    ['binomial', 1], ['count', 2], ['revenue', 5],
  ] as const)('%s uses only in-window events and includes every exposed unit', (kind, value) => {
    expect(perUnitValues(units, events, { kind, windowHours: 2 })).toEqual(
      new Map([['a', value], ['b', 0], ['c', 0]]),
    )
  })

  test('endedAt truncates the window, excluding events exactly at the cutoff', () => {
    expect(perUnitValues(units, events, { kind: 'revenue', windowHours: 8, endedAt: at(2) }))
      .toEqual(new Map([['a', 2], ['b', 0], ['c', 0]]))
  })

  test('endedAt cannot extend a shorter attribution window', () => {
    expect(perUnitValues(units, events, { kind: 'revenue', windowHours: 1, endedAt: at(9) }))
      .toEqual(new Map([['a', 2], ['b', 0], ['c', 0]]))
  })

  test('a zero-valued event still converts and counts; revenue sums refunds', () => {
    const rows = [
      { unitId: 'a', value: 0, ts: at(1) },
      { unitId: 'a', value: -2, ts: at(2) },
    ]
    expect(perUnitValues(units, rows, { kind: 'binomial', windowHours: 2 }).get('a')).toBe(1)
    expect(perUnitValues(units, rows, { kind: 'count', windowHours: 2 }).get('a')).toBe(2)
    expect(perUnitValues(units, rows, { kind: 'revenue', windowHours: 2 }).get('a')).toBe(-2)
  })

  test('no events produces zeros; no exposed units produces an empty map', () => {
    expect(perUnitValues(units, [], { kind: 'revenue', windowHours: 2 }))
      .toEqual(new Map([['a', 0], ['b', 0], ['c', 0]]))
    expect(perUnitValues(new Map(), events, { kind: 'count', windowHours: 2 })).toEqual(new Map())
  })
})
