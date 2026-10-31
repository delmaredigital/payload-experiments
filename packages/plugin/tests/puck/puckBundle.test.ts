import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

const path = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url))
const forbidden = /^(payload(?:\/|$)|@payloadcms\/|@puckeditor\/core(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/

test('/puck reaches only server-safe code and the approved client leaves', () => {
  const graph = collectImports(path('exports/puck.ts'))
  expect([...graph.bare, ...graph.dynamic].filter(specifier => forbidden.test(specifier))).toEqual([])
  expect(graph.dynamic).toEqual([])
  expect(graph.files.filter(file => /\/src\/(db|server|endpoints|admin)\/|\/src\/puck\/editor\//.test(file))).toEqual([])
  const allowedClient = new Set([
    'client/ViewportExposure.tsx', 'puck/ExperimentPicker.tsx',
    'client/beacon.ts',
  ].map(path))
  const clients = graph.files.filter(file => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')))
  expect(clients).toContain(path('client/ViewportExposure.tsx'))
  expect(clients).toContain(path('puck/ExperimentPicker.tsx'))
  expect(clients.filter(file => !allowedClient.has(file))).toEqual([])
  for (const file of ['exports/puck.ts', 'puck/ExperimentSlot.tsx', 'puck/experimentSlotField.ts']) {
    expect(readFileSync(path(file), 'utf8')).not.toMatch(/^\s*['"]use client['"]/)
  }
})
