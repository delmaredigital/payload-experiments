import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { generateEditorCss, referencePalette } from '../../../../scripts/generate-editor-css.mjs'
const source = new URL('../../src/', import.meta.url)
const declarations = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim().replace(/\s+/g, ' ')]))
test('committed editor.css is byte-identical to the in-memory generator', () => {
  expect(readFileSync(new URL('puck/editor/editor.css', source), 'utf8')).toBe(generateEditorCss())
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
