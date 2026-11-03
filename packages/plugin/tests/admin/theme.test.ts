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

test('Puck editor chrome uses scoped classes, tokens, and explicit reset-resistant controls', () => {
  const css = readFileSync(join(src, 'puck/editor/editor.css'), 'utf8')
  expect(css).not.toContain('!important')
  const rules = css.replace(/^(?:\[data-theme='dark'\] )?\.xp-slot-root\s*\{[^}]+\}/gm, '')
  expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
  expect(references(css).every(name => name.startsWith('--xp-'))).toBe(true)
  const controls = css.match(/\.xp-slot-button,\s*\.xp-slot-tab,\s*\.xp-slot-input\s*\{([^}]+)\}/)?.[1] ?? ''
  for (const declaration of ['appearance: none', 'background:', 'border:', 'padding:', 'border-radius:', 'font: inherit', 'font-size:', 'color:', 'cursor:', 'line-height:']) {
    expect(controls, declaration).toContain(declaration)
  }
  for (const control of ['button', 'tab', 'input']) {
    expect(css).toContain(`.xp-slot-${control}:focus-visible`)
    expect(css).toContain(`.xp-slot-${control}:disabled`)
  }
  for (const file of ['ExperimentSlotEditor.tsx', 'CreateExperimentDrawer.tsx']) {
    expect(readFileSync(join(src, 'puck/editor', file), 'utf8')).not.toContain('style=')
  }
})

test('Puck iframe styles define every used token as a literal on the light and dark roots', () => {
  const css = readFileSync(join(src, 'puck/editor/editor.css'), 'utf8')
  const used = new Set(references(css))
  expect(used.size).toBeGreaterThan(0)
  for (const selector of ['.xp-slot-root', "[data-theme='dark'] .xp-slot-root"]) {
    const start = css.indexOf(`\n${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    const block = css.slice(start + 1).match(/^[^{]+\{([^}]+)\}/)?.[1] ?? ''
    expect(block, selector).not.toBe('')
    expect(block, selector).not.toContain('var(')
    const defined = new Set(declarations(block))
    expect([...used].filter(name => !defined.has(name)), selector).toEqual([])
  }
  expect(css).not.toMatch(/@import|var\(\s*--(?:theme|base|style|font)/)
})
