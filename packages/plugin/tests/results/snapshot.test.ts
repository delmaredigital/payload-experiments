import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import type { Snapshot } from '../../src/types/snapshot.js'
import { assembleSnapshot, jsonInterval, validateSnapshot } from '../../src/results/snapshot.js'
import { collectImports } from '../_helpers/importGraph.js'

const directory = new URL('../_fixtures/snapshots/', import.meta.url)
const names = readdirSync(directory).filter(name => name.endsWith('.json'))
const fixture = (name: string): Snapshot => JSON.parse(readFileSync(new URL(name, directory), 'utf8'))

test.each(names)('shared %s validates with winnerArm and minExposuresPerArm', name => {
  const value = fixture(name)
  expect(() => validateSnapshot(value)).not.toThrow()
  expect(assembleSnapshot(value)).toBe(value)
})

test('missing fields, non-finite moments and missing rollout winner are rejected', () => {
  for (const field of ['winnerArm', 'minExposuresPerArm', 'metrics', 'params']) {
    const value = fixture('T7.json') as unknown as Record<string, unknown>
    delete value[field]
    expect(() => validateSnapshot(value)).toThrow(/shape/)
  }
  const value = fixture('R3.json')
  value.winnerArm = null
  expect(() => validateSnapshot(value)).toThrow(/invariants/)
  value.winnerArm = 'variantA'
  value.metrics[0]!.perArm[0]!.sum = Infinity
  expect(() => validateSnapshot(value)).toThrow(/finite/)
})

test('only finite CI limits enter JSON', () => {
  expect(jsonInterval([-Infinity, Infinity])).toEqual([null, null])
  expect(jsonInterval([NaN, .1])).toEqual([null, .1])
  expect(jsonInterval([null, 0])).toEqual([null, 0])
})

test('analysis helpers depend only on the pure stats engine and contain no clock or I/O calls', () => {
  for (const name of ['analyse', 'cuped', 'power', 'srm', 'snapshot']) {
    const path = fileURLToPath(new URL(`../../src/results/${name}.ts`, import.meta.url))
    const graph = collectImports(path)
    expect(graph.bare.filter(name => name !== '@delmaredigital/experiments-stats')).toEqual([])
    expect(graph.dynamic).toEqual([])
    expect(readFileSync(path, 'utf8')).not.toMatch(/Date\.now\(|\bfetch\(/)
  }
})


test('page health is optional on old snapshots and validated on new snapshots', () => {
  const snapshot = fixture('T7.json')
  snapshot.health = [{ code: 'version-page-unavailable', path: '/version' }, { code: 'version-page-unchecked', path: '/other' }]
  expect(() => validateSnapshot(snapshot)).not.toThrow()
  expect(() => validateSnapshot({ ...snapshot, health: [{ code: 'unknown', path: '/version' }] })).toThrow(/shape/)
  expect(() => validateSnapshot({ ...snapshot, health: [{ code: 'version-page-unavailable' }] })).toThrow(/shape/)
})
