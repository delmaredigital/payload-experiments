import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
import { hasClientDirective } from './clientDirective.js'

const path = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url))
const forbidden = /^(payload(?:\/|$)|@payloadcms\/|@puckeditor\/core(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/

test('/puck reaches only server-safe code and the approved client leaves', () => {
  const graph = collectImports(path('exports/puck.ts'))
  expect([...graph.bare, ...graph.dynamic].filter(specifier => forbidden.test(specifier))).toEqual([])
  expect(graph.dynamic).toEqual([])
  expect(graph.files.filter(file => /\/src\/(db|server|endpoints|admin)\/|\/src\/puck\/editor\//.test(file))).toEqual([])
  const allowedClient = new Set([
    'client/ViewportExposure.tsx', 'puck/ExperimentPicker.tsx',
    'client/beacon.ts', 'puck/hostContext.tsx',
  ].map(path))
  const clients = graph.files.filter(file => hasClientDirective(readFileSync(file, 'utf8')))
  expect(clients).toContain(path('client/ViewportExposure.tsx'))
  expect(clients).toContain(path('puck/ExperimentPicker.tsx'))
  expect(clients.filter(file => !allowedClient.has(file))).toEqual([])
  for (const file of ['exports/puck.ts', 'puck/ExperimentSlot.tsx', 'puck/experimentSlotField.ts']) {
    expect(hasClientDirective(readFileSync(path(file), 'utf8'))).toBe(false)
  }
})

test('/puck source graph reaches no CSS imports', () => {
  const graph = collectImports(path('exports/puck.ts'))
  expect([...graph.files, ...graph.bare, ...graph.dynamic].filter(file => /\.css$/i.test(file))).toEqual([])
})

test('bundle directive detection includes comments and earlier directives, but stops after code', () => {
  expect(hasClientDirective("// leading comment\n'use client'\nexport const X = 1")).toBe(true)
  expect(hasClientDirective("/* comment */ 'use strict'; 'use client';")).toBe(true)
  expect(hasClientDirective("import './helper.js'; 'use client';")).toBe(false)
})
