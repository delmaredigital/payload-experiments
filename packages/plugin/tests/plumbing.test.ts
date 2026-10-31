import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const entries = [
  ['.', 'index'],
  ['./runtime/proxy', 'runtimeProxy'],
  ['./runtime/server', 'runtimeServer'],
  ['./proxy', 'proxy'],
  ['./rsc', 'rsc'],
  ['./client', 'client'],
  ['./admin/client', 'adminClient'],
  ['./puck', 'puck'],
  ['./puck/editor', 'puckEditor'],
] as const

describe('plugin package plumbing', () => {
  test('declares all nine public entries', () => {
    expect(Object.keys(manifest.exports)).toEqual(entries.map(([entry]) => entry))
  })

  test.each(entries)('%s preserves the barrel name when swc strips the leading path', (entry, name) => {
    expect(manifest.exports[entry]).toEqual({
      '@delmaredigital/source': `./src/exports/${name}.ts`,
      types: `./dist/exports/${name}.d.ts`,
      import: `./dist/exports/${name}.js`,
      default: `./dist/exports/${name}.js`,
    })
  })

  test('points main and types at the root barrel', () => {
    expect(manifest.main).toBe('./dist/exports/index.js')
    expect(manifest.types).toBe('./dist/exports/index.d.ts')
  })

  test('requires the Postgres adapter and driver as peers', () => {
    expect(manifest.peerDependencies['@payloadcms/db-postgres']).toBe('>=3.90.0 <4')
    expect(manifest.peerDependencies.pg).toBe('>=8.13.0 <9')
  })
})
