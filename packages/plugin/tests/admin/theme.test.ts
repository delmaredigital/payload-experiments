import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
const themePath = join(src, 'admin/theme.css')
const require = createRequire(import.meta.url)
function filesUnder(directory: string, extension: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path, extension) : extension.test(entry.name) ? [path] : []
  })
}
const references = (source: string) => [...source.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]!)
const declarations = (source: string) => [...source.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]!)

test('every plugin token reference is defined in theme.css', () => {
  const defined = new Set(declarations(readFileSync(themePath, 'utf8')))
  expect(defined.size).toBeGreaterThan(0)
  const missing = filesUnder(src, /./).flatMap(path =>
    references(readFileSync(path, 'utf8')).filter(name => name.startsWith('--xp-') && !defined.has(name))
      .map(name => `${path}: ${name}`))
  expect(missing).toEqual([])
})

test('theme aliases resolve to installed Payload CSS or SCSS declarations', () => {
  const entry = dirname(require.resolve('@payloadcms/ui'))
  const dist = entry.slice(0, entry.lastIndexOf('/dist') + '/dist'.length)
  const defined = new Set(filesUnder(dist, /\.(css|scss)$/).flatMap(path => declarations(readFileSync(path, 'utf8'))))
  for (const name of ['--theme-text', '--theme-elevation-150', '--base']) expect(defined.has(name), name).toBe(true)
  const missing = references(readFileSync(themePath, 'utf8')).filter(name => !defined.has(name))
  expect(missing).toEqual([])
})

test('only theme.css references Payload tokens directly', () => {
  const direct = /--(?:theme-|base\b|style-|font-)/g
  const violations = filesUnder(src, /\.(css|ts|tsx)$/).filter(path => path !== themePath).flatMap(path =>
    [...readFileSync(path, 'utf8').matchAll(direct)].map(match => `${path}: ${match[0]}`))
  expect(violations).toEqual([])
})
