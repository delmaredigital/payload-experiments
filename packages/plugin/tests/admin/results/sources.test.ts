import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, test } from 'vitest'
const src = fileURLToPath(new URL('../../../src/', import.meta.url))
test('results and its shared actions use plugin inputs and contain no Mean copy', () => {
  const paths = ['testSurface/results', 'testSurface/actions', 'admin/surface/results', 'testSurface/surface/results'].flatMap(dir => readdirSync(join(src, dir)).filter(file => /\.tsx?$/.test(file)).map(file => join(dir, file)))
  paths.push('testSurface/PreviewLinks.tsx', 'admin/surface/ResultsRoute.tsx', 'testSurface/copy/results.ts')
  for (const path of paths) {
    const source = readFileSync(join(src, path), 'utf8')
    expect(source, path).not.toMatch(/\bMean\b/)
    for (const match of source.matchAll(/import\s*{([^}]+)}\s*from\s*['"]@payloadcms\/ui['"]/g)) {
      expect(match[1], path).not.toMatch(/\b(Button|SelectInput|TextareaInput|TextInput)\b/)
    }
  }
})
