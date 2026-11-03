import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

function violations(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? violations(path) : readFileSync(path, 'utf8').includes('collections/xp-') ? [path] : []
  })
}
test('admin source never links to raw plugin collections', () => {
  expect(violations(fileURLToPath(new URL('../../src/admin/', import.meta.url)))).toEqual([])
})
