import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { generateEditorCss, referencePalette } from '../../../../scripts/generate-editor-css.mjs'
const source = new URL('../../src/', import.meta.url)
const declarations = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim().replace(/\s+/g, ' ')]))
const require = createRequire(import.meta.url)
type CssNode = { type: string; name?: string; property?: string; value?: CssNode; prelude?: CssNode; block?: CssNode; children?: { toArray(): CssNode[] } }
const cssParser = createRequire(require.resolve('jsdom'))('css-tree') as {
  parse(source: string): CssNode
  walk(node: CssNode, visit: (node: CssNode) => void): void
  generate(node: CssNode): string
}
function generatedRules() {
  const result = new Map<string, CssNode>()
  cssParser.walk(cssParser.parse(readFileSync(new URL('puck/editor/editor.css', source), 'utf8')), node => {
    if (node.type === 'Rule') for (const selector of node.prelude!.children!.toArray()) result.set(cssParser.generate(selector), node)
  })
  return result
}
function properties(rule: CssNode) {
  return Object.fromEntries(rule.block!.children!.toArray().filter(node => node.type === 'Declaration')
    .map(node => [node.property!, cssParser.generate(node.value!)]))
}
// These selectors use only attributes, classes, pseudo-classes and element names.
function specificity(selector: string): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0]
  cssParser.walk(cssParser.parse(`${selector}{}`), node => {
    if (node.type === 'IdSelector') result[0]++
    if (['ClassSelector', 'AttributeSelector', 'PseudoClassSelector'].includes(node.type)) result[1]++
    if (['TypeSelector', 'PseudoElementSelector'].includes(node.type)) result[2]++
  })
  return result
}
function contrast(foreground: string, background: string): number {
  function luminance(color: string) {
    const channels = color.startsWith('#') ? color.slice(1).match(/../g)!.map(channel => parseInt(channel, 16)) : color.match(/[\d.]+/g)!.map(Number)
    const linear = channels.map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 })
    return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
test('committed editor.css is byte-identical to the in-memory generator', () => {
  expect(readFileSync(new URL('puck/editor/editor.css', source), 'utf8')).toBe(generateEditorCss())
})
test('the third token block restores light tokens only in the Puck field sidebar after the dark block', () => {
  const css = readFileSync(new URL('puck/editor/editor.css', source), 'utf8')
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]+)\}/g)].filter(block => block[2]!.includes('--xp-bg:'))
  expect(blocks).toHaveLength(3)
  expect(blocks[2]![1]!.trim()).toBe('[class*="_PuckFields"] .xp-slot-root')
  expect(declarations(blocks[2]![2]!)).toEqual(declarations(blocks[0]![2]!))
  expect(blocks[2]!.index).toBeGreaterThan(blocks[1]!.index!)
})

test.each([
  ['.xp-ui-button--secondary', '--xp-text'], ['.xp-ui-button--primary', '--xp-accent-fg'],
  ['.xp-ui-error', '--xp-error'], ['.xp-ui-help', '--xp-text-2'], ['.xp-ui-field label', '--xp-text'],
])('sidebar %s colour beats the host dark-mode text override', (target, token) => {
  const selector = `[class*="_PuckFields"] .xp-slot-root ${target}`
  const rule = generatedRules().get(selector)
  expect(rule, selector).toBeDefined()
  expect(properties(rule!).color).toBe(`var(${token})`)
  const [ids, classes, elements] = specificity(selector)
  expect(ids > 0 || classes > 2 || classes === 2 && elements > 1).toBe(true)
})

test('sidebar enabled and solid disabled buttons meet their text contrast thresholds', () => {
  const rules = generatedRules()
  const disabled = properties(rules.get('[class*="_PuckFields"] .xp-puck-field .xp-ui-button:disabled')!)
  expect(disabled).toMatchObject({ opacity: '1', background: 'var(--xp-surface-3)', color: 'var(--xp-text-2)', 'border-color': 'var(--xp-border-strong)' })
  const css = readFileSync(new URL('puck/editor/editor.css', source), 'utf8')
  const tokens = declarations(css.match(/\[class\*="_PuckFields"\] \.xp-slot-root\s*\{([^}]+)\}/)![1]!)
  const resolve = (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => tokens[name]!)
  const primary = properties(rules.get('.xp-ui-button--primary')!)
  const secondary = properties(rules.get('.xp-ui-button--secondary')!)
  for (const [variant, background] of [['primary', primary.background], ['secondary', secondary.background]] as const) {
    const foreground = properties(rules.get(`[class*="_PuckFields"] .xp-slot-root .xp-ui-button--${variant}`)!).color!
    expect(contrast(resolve(foreground), resolve(background!)), variant).toBeGreaterThanOrEqual(4.5)
  }
  expect(contrast(resolve(disabled.color!), resolve(disabled.background!))).toBeGreaterThanOrEqual(3)
})

test('installed Puck still ships the field-panel class used by the sidebar theme boundary', () => {
  const shipped = readFileSync(require.resolve('@puckeditor/core/puck.css'), 'utf8')
  expect(shipped).toMatch(/\._PuckFields[\w-]*/)
})
test.each(['light', 'dark'] as const)('every %s token equals theme.css resolved against reference Payload', mode => {
  const theme = readFileSync(new URL('admin/theme.css', source), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const split = theme.indexOf('[data-theme="dark"]')
  const tokens = { ...declarations(theme.slice(0, split)), ...(mode === 'dark' ? declarations(theme.slice(split)) : {}) }
  const palette = referencePalette(mode)
  function resolve(value: string): string {
    return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(tokens[name] ?? palette[name] ?? (() => { throw new Error(name) })()))
  }
  const css = readFileSync(new URL('puck/editor/editor.css', source), 'utf8')
  const blocks = [...css.matchAll(/\.xp-slot-root\s*\{([^}]+)\}/g)]
  const committed = declarations(blocks[mode === 'light' ? 0 : 1]![1]!)
  expect(Object.keys(committed).sort()).toEqual(Object.keys(tokens).sort())
  for (const [name, value] of Object.entries(tokens)) {
    expect(committed[name], name).toBe(resolve(value))
    expect(committed[name], name).not.toContain('var(')
  }
})

test('reference generation is pinned independently to Payload UI 3.90.2 and known palette literals', () => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@payloadcms/ui')
  const dist = entry.slice(0, entry.lastIndexOf('/dist/') + 5)
  const installed = JSON.parse(readFileSync(join(dirname(dist), 'package.json'), 'utf8')) as { version: string }
  expect(installed.version).toBe('3.90.2')
  const css = readFileSync(new URL('puck/editor/editor.css', source), 'utf8')
  const blocks = [...css.matchAll(/\.xp-slot-root\s*\{([^}]+)\}/g)]
  const light = declarations(blocks[0]![1]!), dark = declarations(blocks[1]![1]!)
  // Independent anchors: do not derive these expected values from the parser.
  const hex = (value: string) => value.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, (_, ...channels: string[]) => '#' + channels.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join(''))
  expect(hex(light['--xp-surface']!)).toBe('#ffffff')
  expect(hex(light['--xp-bg']!)).toBe('#f5f5f5')
  expect(hex(dark['--xp-bg']!)).toBe('#141414')
})
