import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { referencePalette } from '../../../../scripts/generate-editor-css.mjs'
import { contrast } from '../../src/ui/accent.js'

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
  const local = new Set(declarations(readFileSync(themePath, 'utf8')))
  const missing = references(readFileSync(themePath, 'utf8')).filter(name => !defined.has(name) && !local.has(name))
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
  // Strips only the three generated token blocks (whole selector is exactly one of them); every other rule,
  // including the [class*="_PuckFields"] chrome overrides, stays under the no-literal-colour check.
  const rules = css.replace(/^(?:\[data-theme='dark'\] \.xp-slot-root,\s*\.dark |\[class\*="_PuckFields"\] )?\.xp-slot-root\s*\{[^}]+\}/gm, '')
  expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
  expect(references(css).every(name => name.startsWith('--xp-'))).toBe(true)
  const controls = css.match(/\.xp-slot-editor \.xp-ui-button,\s*\.xp-slot-editor \.xp-ui-tab,\s*\.xp-slot-editor \.xp-ui-input\s*\{([^}]+)\}/)?.[1] ?? ''
  expect(controls).toContain('appearance: none')
  for (const control of ['button', 'tab', 'input']) {
    const rule = css.match(new RegExp(`\\.xp-ui-${control} \\{([^}]+)\\}`))?.[1] ?? ''
    for (const declaration of ['background:', 'border:', 'padding:', 'border-radius:', 'font:', 'color:']) expect(rule, `${control}: ${declaration}`).toContain(declaration)
    expect(css).toContain(`.xp-ui-${control}:focus-visible`)
    expect(css).toContain(`.xp-ui-${control}:disabled`)
  }
  expect(css).toMatch(/\.xp-slot-editor \.xp-ui-dialog\s*\{[^}]*margin: auto;/)
  // The only inline chrome style is the explicitly validated host accent.
  expect(readFileSync(join(src, 'puck/editor/ExperimentSlotEditor.tsx'), 'utf8')).toContain('style={props.accent ? accentVariables(props.accent[mode])')
  expect(readFileSync(join(src, 'puck/editor/CreateExperimentDrawer.tsx'), 'utf8')).not.toContain('style=')
})

test('Puck iframe styles define every used token as a literal on the light and dark roots', () => {
  const css = readFileSync(join(src, 'puck/editor/editor.css'), 'utf8')
  const used = new Set(references(css))
  expect(used.size).toBeGreaterThan(0)
  for (const selector of ['.xp-slot-root', "[data-theme='dark'] .xp-slot-root,\n.dark .xp-slot-root"]) {
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

test('the design vocabulary is complete and mirrored by theme.ts', () => {
  const css = readFileSync(themePath, 'utf8')
  const ts = readFileSync(join(src, 'admin/theme.ts'), 'utf8')
  const names = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-2', 'text-3',
    'accent', 'accent-text', 'accent-hover', 'accent-active', 'accent-subtle', 'accent-fg', 'focus', 'series-a', 'series-b', 'series-muted',
    'radius-control', 'radius-card', 'radius-chip', 'font', 'mono', 'text-display', 'text-title', 'text-body', 'text-small', 'motion',
    ...Array.from({ length: 8 }, (_, index) => `space-${index + 1}`),
    ...['success', 'warning', 'error'].flatMap(name => [name, `${name}-bg`, `${name}-border`])]
  for (const name of names) {
    expect(css).toContain(`--xp-${name}:`)
    expect(ts).toContain(`var(--xp-${name})`)
  }
})

function themeTokens(mode: 'light' | 'dark') {
  const css = readFileSync(themePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const split = css.indexOf('[data-theme="dark"]')
  const parse = (source: string): Record<string, string> => Object.fromEntries(
    [...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]))
  const tokens = { ...parse(css.slice(0, split)), ...(mode === 'dark' ? parse(css.slice(split)) : {}) }
  const palette = referencePalette(mode)
  const resolve = (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(tokens[name] ?? palette[name]!))
  return { tokens, resolve }
}

test.each(['light', 'dark'] as const)('%s semantic literals contrast with their backgrounds and the reference surface', mode => {
  const { tokens, resolve } = themeTokens(mode)
  const expected = mode === 'light'
    ? { success: ['#1a6a3a', '#e8f4ec', '#bddfc9'], warning: ['#8a5a0b', '#fbf3e1', '#ecd6a2'], error: ['#a63030', '#fbeaea', '#efc3c3'] }
    : { success: ['#7fd49c', '#142b1d', '#23492f'], warning: ['#e7bd5c', '#2b2312', '#4d3d17'], error: ['#f09494', '#2f1717', '#5a2626'] }
  for (const [name, literals] of Object.entries(expected)) {
    const [fg, bg, border] = ['', '-bg', '-border'].map(suffix => tokens[`--xp-${name}${suffix}`]!)
    expect([fg, bg, border]).toEqual(literals)
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(fg!, resolve(tokens['--xp-surface']!).replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, (_, ...channels: string[]) => '#' + channels.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join('')))).toBeGreaterThanOrEqual(4.5)
    // Borders are decorative; they carry no text and are not text-contrast gated.
    for (const suffix of ['text', 'text-strong']) {
      if (tokens[`--xp-${name}-${suffix}`]) expect(resolve(tokens[`--xp-${name}-${suffix}`]!)).toBe(fg)
    }
  }
})

test.each(['light', 'dark'] as const)('%s has five distinct reference surface steps and neutral default accent text', mode => {
  const { tokens, resolve } = themeTokens(mode)
  const surfaces = ['bg', 'surface', 'surface-2', 'surface-3', 'accent-subtle'].map(name => resolve(tokens[`--xp-${name}`]!))
  expect(new Set(surfaces).size).toBe(5)
  expect(resolve(tokens['--xp-accent-text']!)).toBe(resolve(tokens['--xp-text']!))
  expect(tokens['--xp-accent-text-decoration']).toBe('none')
  expect([tokens['--xp-series-a'], tokens['--xp-series-b']]).toEqual(mode === 'light' ? ['#2a78d6', '#eb6834'] : ['#3987e5', '#d95926'])
})

test.each(['light', 'dark'] as const)('%s default status chip has a border distinct from its background', mode => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8')
  const chip = css.match(/\.xp-ui-status \{([^}]+)\}/)![1]!
  const { tokens, resolve } = themeTokens(mode)
  const border = chip.match(/border: 1px solid (var\(--[\w-]+\))/)![1]!
  const background = chip.match(/background: (var\(--[\w-]+\))/)![1]!
  expect(resolve(border)).not.toBe(resolve(background))
  // elevation-100 is already surface-2, so accent-subtle needs another step.
  expect(resolve(tokens['--xp-accent-subtle']!)).not.toBe(resolve('var(--theme-elevation-100)'))
})

test.each(['light', 'dark'] as const)('%s disabled page rows have a visible dashed border at 3:1 against both row backgrounds', mode => {
  const css = readFileSync(join(src, 'admin/surface/pagePicker/pagePicker.css'), 'utf8')
  const rule = css.match(/\.xp-page-option\[aria-disabled='true'\] \{([^}]+)\}/)![1]!
  expect(rule).toContain('border-style: dashed')
  const { resolve } = themeTokens(mode)
  const localBorder = rule.match(/border-color: ([^;]+);/)![1]!
  const hex = (value: string) => resolve(value).replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, (_, ...channels: string[]) => '#' + channels.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join(''))
  for (const background of ['surface', 'surface-2']) expect(contrast(hex(localBorder), hex(`var(--xp-${background})`))).toBeGreaterThanOrEqual(3)
})
