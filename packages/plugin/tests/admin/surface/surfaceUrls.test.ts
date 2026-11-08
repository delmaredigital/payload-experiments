import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { surfaceUrls } from '../../../src/admin/surfaceUrls.js'

test.each(['/control', '/'])('collection list URLs keep repeated query values with admin=%s', admin => {
  const base = admin === '/' ? '' : admin
  expect(surfaceUrls.home(admin)).toBe(`${base}/collections/xp-experiments`)
  expect(surfaceUrls.goals(admin, { return: 'x/y', filter: ['one', 'two'], absent: undefined }))
    .toBe(`${base}/collections/xp-metrics?return=x%2Fy&filter=one&filter=two`)
})

test('all list URL producers use the shared helper; deeper surface routes stay local', () => {
  const root = fileURLToPath(new URL('../../../src/admin/', import.meta.url))
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])
  }
  for (const file of files(root).filter(file => /\.tsx?$/.test(file))) {
    const source = readFileSync(file, 'utf8')
    // Root's login path and route parser deliberately retain the legacy namespace.
    if (file.endsWith('/ExperimentsRootView.tsx')) continue
    expect(source, file).not.toMatch(/['"`]\/experiments(?:\/goals)?(?:['"`]|\$\{(?:returnQuery|!reason)|\?)/)
    if (!file.endsWith('/surfaceUrls.ts')) expect(source, file).not.toMatch(/path: ['"`]\/collections\/xp-(?:experiments|metrics)/)
  }
})
