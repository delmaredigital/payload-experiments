import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
const reachable = new Set(readdirSync(join(src, 'exports')).filter(file => file.endsWith('.ts'))
  .flatMap(file => collectImports(join(src, 'exports', file), { includeTypes: true }).files))
const orphans = (inventory: string[]) => inventory.filter(file => /\.tsx?$/.test(file) && !reachable.has(file))
test('admin source is reachable from public entries', () => {
  const found = orphans(files(join(src, 'admin')))
  expect(found).toEqual([])
})
test('an orphan fixture is reported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-admin-orphan-'))
  try {
    const fixture = join(directory, 'orphan.ts')
    writeFileSync(fixture, 'export const abandoned = true')
    expect(orphans(files(directory))).toEqual([fixture])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
