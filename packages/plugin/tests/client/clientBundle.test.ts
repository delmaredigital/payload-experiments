import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'

afterEach(__resetBeaconsForTests)
const path = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url))
const forbidden = /^(payload(?:\/|$)|@payloadcms\/|@puckeditor\/core(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/

test.each(['exports/client.ts', 'client/ViewportExposure.tsx'])('%s has only browser-safe value imports', file => {
  const graph = collectImports(path(file))
  expect([...graph.bare, ...graph.dynamic].filter(specifier => forbidden.test(specifier))).toEqual([])
  expect(graph.files.filter(file => /\/src\/(db|server|endpoints)\//.test(file))).toEqual([])
  expect(graph.dynamic).toEqual([])
})

test.each(['ExperimentsProvider.tsx', 'useFlagPoint.ts', 'useExperiment.ts', 'ExperimentPageview.tsx', 'ViewportExposure.tsx', 'trackConversionBeacon.ts', 'beacon.ts', 'idempotency.ts'])('%s has a client directive and no placeholder', file => {
  const source = readFileSync(path(`client/${file}`), 'utf8')
  expect(source.startsWith("'use client'")).toBe(true)
  expect(source).not.toContain('// XP-PLACEHOLDER')
})

test('internal viewport and test reset are not exported from the public barrel', () => {
  const source = readFileSync(path('exports/client.ts'), 'utf8')
  expect(source).not.toContain('ViewportExposure')
  expect(source).not.toContain('__resetBeaconsForTests')
})
