import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

// Use the CSS parser supplied by the existing jsdom test dependency.
const require = createRequire(import.meta.url)
type CssNode = {
  type: string; name?: string; property?: string; value?: CssNode
  prelude?: CssNode; block?: CssNode; children?: { toArray(): CssNode[] }
}
const css = createRequire(require.resolve('jsdom'))('css-tree') as {
  parse(source: string, options?: { parseCustomProperty: boolean }): CssNode
  walk(node: CssNode, visit: (node: CssNode) => void): void
  generate(node: CssNode): string
}
const source = new URL('../../src/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8')

function rules(text: string): CssNode[] {
  const result: CssNode[] = []
  css.walk(css.parse(text, { parseCustomProperty: true }), node => {
    if (node.type === 'Rule') result.push(node)
  })
  return result
}

function references(node: CssNode): string[] {
  const names = new Set<string>()
  css.walk(node, child => {
    if (child.type !== 'Function' || child.name !== 'var') return
    const argument = child.children?.toArray()[0]
    if (argument?.type === 'Identifier' && argument.name?.startsWith('--xp-')) names.add(argument.name)
  })
  return [...names]
}

test('every picker class is defined by the shared admin UI stylesheet', () => {
  const picker = ts.createSourceFile('ExperimentPicker.tsx', read('puck/ExperimentPicker.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const classes = new Set<string>()
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(picker) === 'className') {
      // Make future dynamic classes explicit here rather than silently omitting them.
      if (!node.initializer || !ts.isStringLiteral(node.initializer)) throw new Error('Picker className must be a literal')
      node.initializer.text.split(/\s+/).filter(Boolean).forEach(name => classes.add(name))
    }
    ts.forEachChild(node, visit)
  }
  visit(picker)
  expect(classes.size).toBeGreaterThan(0)
  const uiRules = rules(read('ui/ui.css'))
  const pickerRules = uiRules.filter(rule => {
    let matches = false
    css.walk(rule.prelude!, node => {
      if (node.type === 'ClassSelector' && classes.has(node.name!)) matches = true
    })
    return matches
  })
  const defined = new Set<string>()
  for (const rule of pickerRules) css.walk(rule.prelude!, node => {
    if (node.type === 'ClassSelector') defined.add(node.name!)
  })
  for (const name of classes) {
    expect(name.startsWith('xp-ui-'), name).toBe(true)
    expect(defined.has(name), `Missing ui.css class .${name}`).toBe(true)
  }

  const themeRules = rules(read('admin/theme.css'))
  const used = new Set(pickerRules.flatMap(rule => references(rule.block!)))
  expect(used.size).toBeGreaterThan(0)
  for (const mode of ['light', 'dark']) {
    const tokens = new Map<string, CssNode>()
    for (const rule of themeRules) {
      const selectors = rule.prelude!.children!.toArray().map(selector => css.generate(selector))
      if (!selectors.some(selector => selector === ':root' || selector === '[data-theme]' ||
        mode === 'dark' && selector === '[data-theme="dark"]')) continue
      for (const declaration of rule.block!.children!.toArray()) {
        if (declaration.type === 'Declaration' && declaration.property?.startsWith('--xp-')) {
          tokens.set(declaration.property, declaration.value!)
        }
      }
    }
    function check(name: string, ancestors: string[] = []) {
      expect(ancestors, `Cyclic ${mode} token ${name}`).not.toContain(name)
      expect(tokens.has(name), `Missing ${mode} theme token ${name}`).toBe(true)
      for (const alias of references(tokens.get(name)!)) check(alias, [...ancestors, name])
    }
    for (const name of used) check(name)
  }
})

test('admin/client loads both shared styles as side effects', () => {
  const graph = collectImports(fileURLToPath(new URL('exports/adminClient.ts', source)))
  for (const path of ['admin/theme.css', 'ui/ui.css']) {
    expect(graph.files).toContain(fileURLToPath(new URL(path, source)))
  }
})
