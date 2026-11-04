import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { generateEditorCss, generateFieldCss, referencePalette } from '../../../../scripts/generate-editor-css.mjs'
const source = new URL('../../src/', import.meta.url)
const declarations = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim().replace(/\s+/g, ' ')]))
describe.each([
  ['puck/editor/editor.css', '.xp-slot-root', generateEditorCss],
  ['puck/field.css', '.xp-puck-field', generateFieldCss],
] as const)('%s', (path, root, generate) => {
  test('committed CSS is byte-identical to the in-memory generator', () => {
    expect(readFileSync(new URL(path, source), 'utf8')).toBe(generate())
  })
  test.each(['light', 'dark'] as const)('every %s token equals theme.css resolved against reference Payload', mode => {
    const theme = readFileSync(new URL('admin/theme.css', source), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const split = theme.indexOf('[data-theme="dark"]')
    const tokens = { ...declarations(theme.slice(0, split)), ...(mode === 'dark' ? declarations(theme.slice(split)) : {}) }
    const palette = referencePalette(mode)
    function resolve(value: string): string {
      return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(tokens[name] ?? palette[name] ?? (() => { throw new Error(name) })()))
    }
    const css = readFileSync(new URL(path, source), 'utf8')
    const blocks = [...css.matchAll(new RegExp(`${root.replace('.', '\\.')}\\s*\\{([^}]+)\\}`, 'g'))]
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
    const css = readFileSync(new URL(path, source), 'utf8')
    const blocks = [...css.matchAll(new RegExp(`${root.replace('.', '\\.')}\\s*\\{([^}]+)\\}`, 'g'))]
    const light = declarations(blocks[0]![1]!), dark = declarations(blocks[1]![1]!)
    // Independent anchors: do not derive these expected values from the parser.
    const hex = (value: string) => value.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, (_, ...channels: string[]) => '#' + channels.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join(''))
    expect(hex(light['--xp-surface']!)).toBe('#ffffff')
    expect(hex(light['--xp-bg']!)).toBe('#f5f5f5')
    expect(hex(dark['--xp-bg']!)).toBe('#141414')
  })

  test('every used token is a literal in both roots, with no host-palette references', () => {
    const css = readFileSync(new URL(path, source), 'utf8')
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]!)
    const blocks = [...css.matchAll(new RegExp(`${root.replace('.', '\\.')}\\s*\\{([^}]+)\\}`, 'g'))].slice(0, 2)
    expect(blocks).toHaveLength(2)
    for (const match of blocks) {
      const tokens = declarations(match[1]!)
      expect(match[1]).not.toContain('var(')
      expect(used.filter(name => !(name in tokens))).toEqual([])
    }
    const rules = css.replace(new RegExp(`[^{}]*${root.replace('.', '\\.')}\\s*\\{[^{}]+\\}`, 'g'), '')
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    expect(css).not.toMatch(/@import|var\(\s*--(?:theme|base|style|font)/)
  })
})

test('field UI rules are nested under the field root and follow host data-theme', () => {
  const css = generateFieldCss()
  expect(css).toContain("[data-theme='dark'] .xp-puck-field {")
  const ui = readFileSync(new URL('ui/ui.css', source), 'utf8')
  expect(css.endsWith(`.xp-puck-field {\n${ui}\n}\n`)).toBe(true)
})
