import { readFileSync, readdirSync } from 'node:fs'
import { referencePalette, resolvedTokens } from '../../../../scripts/generate-editor-css.mjs'
import ts from 'typescript'
import { contrast } from '../../src/ui/accent.js'
import { expect, test } from 'vitest'

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8')
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
function rule(selector: string): string {
  return rules.filter(m => m[1]!.trim().split(',').map(s => s.trim()).includes(selector)).map(m => m[2]).join('\n')
}

test('page content stacks with a full-width picker, quiet disabled reasons and indented copy steps', () => {
  const page = readFileSync(new URL('../../src/testSurface/surface/test/testPage.css', import.meta.url), 'utf8') + readFileSync(new URL('../../src/testSurface/surface/pagePicker/pagePicker.css', import.meta.url), 'utf8')
  const declarations = (selector: string) => [...page.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(match => match[1]!.trim() === `:where(.xp-test-surface) ${selector}`).map(match => match[2]).join('\n')
  expect(declarations('.xp-version-content--page')).toContain('flex-direction: column')
  expect(declarations('.xp-version-content--page')).toContain('align-items: stretch')
  expect(declarations('.xp-version-content--page')).toMatch(/gap: var\(--xp-space-/)
  expect(declarations('.xp-page-combobox')).toContain('width: 100%')
  expect(declarations('.xp-page-combobox input')).toContain('width: 100%')
  expect(declarations('.xp-page-option')).toContain('display: block')
  expect(declarations('.xp-page-option')).toContain('width: 100%')
  expect(declarations('.xp-page-option')).toContain('text-align: left')
  expect(declarations('.xp-page-option-detail')).toContain('color: var(--xp-text-2)')
  expect(declarations('.xp-page-option-detail')).toContain('font: var(--xp-text-small)')
  expect(declarations('.xp-copy-route ol')).toContain('list-style: decimal')
  expect(declarations('.xp-copy-route ol')).toMatch(/padding-inline-start: var\(--xp-space-/)
})

test('chips errors keep the red message and the same invalid border as text inputs', () => {
  expect(rule('.xp-ui-chips-control--invalid')).toContain('border-color: var(--xp-error)')
  expect(rule(".xp-ui-input[aria-invalid='true']")).toContain('border-color: var(--xp-error)')
  expect(rule('.xp-ui-error')).toContain('color: var(--xp-error)')
  expect(rule('.xp-ui-chips p')).toBe('')
  expect(rule('.xp-ui-chips p:not(.xp-ui-error)')).toContain('color: var(--xp-text-muted)')
})

test('narrow-width CSS audit: controls fit their containing block and action rows wrap', () => {
  // Node-only CSS audit; jsdom cannot prove element geometry. Exp-admin repeats
  // the 390px screenshots. These rules remove intrinsic grid/input overflow.
  for (const selector of ['.xp-ui-input', '.xp-ui-chips', '.xp-ui-chips-control', '.xp-ui-chips .xp-ui-chips-control input']) {
    const declarations = rule(selector)
    for (const expected of ['width: 100%', 'max-width: 100%', 'box-sizing: border-box']) {
      expect(declarations, `${selector}: ${expected}`).toContain(expected)
    }
    // A minimum never wider than the container still fits; the chips input keeps a readable 28ch when there is room.
    expect(declarations, `${selector}: min-width`).toMatch(/min-width: (0|min\(100%, [^)]+\));/)
  }
  for (const selector of ['.xp-ui-button-group', '.xp-ui-tablist', '.xp-ui-banner', '.xp-ui-section-head']) {
    expect(rule(selector), selector).toContain('flex-wrap: wrap')
  }
  expect(rule('.xp-ui-button')).toContain('max-width: 100%')
  expect(rule('.xp-ui-button')).toContain('white-space: normal')
  expect(css).not.toMatch(/min-width:\s*(?:[1-9][\d.]*)(?:px|rem|em)/)
  const fixture = readFileSync(new URL('../../tests-fixtures/ui/renderUiFixtures.fixture.tsx', import.meta.url), 'utf8')
  expect(fixture).toContain('main { box-sizing: border-box; width: 100%; min-width: 0;')
  expect(fixture).toContain('grid-template-columns: minmax(0, 1fr)')
  expect(fixture).toContain('.fixture-row { min-width: 0; max-width: 100%; display: flex; gap: 8px; flex-wrap: wrap;')
})

test('text accents use the accessible text token and its fallback decoration together', () => {
  for (const selector of [".xp-ui-tab[aria-selected='true']"]) {
    expect(rule(selector), selector).toContain('color: var(--xp-accent-text)')
    expect(rule(selector), selector).toContain('text-decoration: var(--xp-accent-text-decoration)')
  }
  // Quiet actions and breadcrumb links stay neutral so a host accent never recolours Cancel.
  expect(rule('.xp-ui-button--quiet')).toContain('color: var(--xp-text-2)')
  expect(rule('.xp-ui-breadcrumb a')).toContain('text-decoration: underline')
  expect(rule('.xp-ui-status--running')).toContain('color: var(--xp-success)')
  expect(rule('.xp-ui-status--ready')).toContain('color: var(--xp-success)')
})

test('plain surface links use neutral text and underline on hover without overriding UI buttons', () => {
  const surface = readFileSync(new URL('../../src/admin/surface/surface.css', import.meta.url), 'utf8')
  expect(surface).toMatch(/\.xp-tests-surface a:not\(\.xp-ui-button\) \{[^}]*color: var\(--xp-text\)/)
  expect(surface).toMatch(/\.xp-tests-surface a:not\(\.xp-ui-button\):hover \{[^}]*text-decoration: underline/)
})


test('surface button defaults cannot restyle chip remove buttons', () => {
  const surface = readFileSync(new URL('../../src/admin/surface/surface.css', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../../src/testSurface/surface/test/testPage.css', import.meta.url), 'utf8')
  expect(surface).not.toContain('.xp-tests-surface button')
  expect(surface).toContain('.xp-tests-toolbar button:not(.xp-ui-button)')
  expect(page).not.toContain('.xp-test-page button:not(.xp-ui-button)')
  expect(rule('.xp-ui-chips .xp-ui-chips-item button')).toContain('background: transparent')
})

test('inline link actions have no horizontal padding and checkbox legends align flush', () => {
  expect(rule('.xp-ui-button--link')).toContain('padding-inline: 0')
  expect(rule('.xp-ui-button--link')).toContain('color: var(--xp-accent-text)')
  expect(rule('.xp-ui-button--link:hover')).toContain('text-decoration: underline')
  expect(rule('.xp-ui-checkbox-list legend')).toContain('padding: 0')
})

test.each(['light', 'dark'] as const)('%s page options have readable text and a visible selection marker', mode => {
  const palette = referencePalette(mode)
  const tokens = resolvedTokens(mode)
  expect(Object.keys(palette).length).toBeGreaterThan(0)
  const hex = (value: string) => value.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/, (_, r: string, g: string, b: string) => '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join(''))
  const values = Object.fromEntries(['text', 'text-2', 'surface', 'surface-2', 'accent'].map(name => [name, hex(tokens[`--xp-${name}`]!)]))
  for (const background of ['surface', 'surface-2']) {
    const ratios = Object.fromEntries(['text', 'text-2', 'accent'].map(name => [name, contrast(values[name]!, values[background]!)]))
    expect(ratios.text).toBeGreaterThanOrEqual(4.5)
    expect(ratios['text-2']).toBeGreaterThanOrEqual(4.5)
    expect(ratios.accent).toBeGreaterThanOrEqual(3)
  }
})

test('dropdown chrome and open menus use shared theme tokens without native select styles', () => {
  expect(rule('.xp-ui-combobox-chevron')).toContain('rotate(45deg)')
  for (const declaration of ['position: fixed', 'z-index: 2147483647', 'background: var(--xp-surface)', 'color: var(--xp-text)', 'font: var(--xp-text-body)']) expect(rule('.xp-ui-combobox-popup')).toContain(declaration)
  expect(rule(".xp-ui-combobox-option[aria-selected='true']")).toContain('background: var(--xp-surface-3)')
  expect(css).not.toContain('.xp-ui-select')
})
test('the plugin renders no native select menus', () => {
  const root = new URL('../../src/', import.meta.url)
  const found: string[] = []
  function scan(directory: URL): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) scan(path)
      else if (/\.tsx$/.test(entry.name)) {
        const tree = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        function visit(node: ts.Node): void {
          const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined
          if (element?.tagName.getText() === 'select') found.push(path.pathname)
          ts.forEachChild(node, visit)
        }
        visit(tree)
      }
    }
  }
  scan(root)
  expect(found).toEqual([])
})

test('aria-disabled controls have the native disabled styling', () => {
  for (const control of ['input', 'button']) expect(rule(`.xp-ui-${control}[aria-disabled='true']`)).toBe(rule(`.xp-ui-${control}:disabled`))
})


function bareSelectRules(source: string): string[] {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(match => match[1]!.split(',').map(selector => selector.trim()))
    .filter(selector => /(^|[\s>+~,(])select(?=[\s.#[:>+~),]|$)/.test(selector))
}
test('package styles never target bare selects that can override the shared Select', () => {
  const root = new URL('../../src/', import.meta.url)
  const files = readdirSync(root, { recursive: true }).map(String).filter(file => file.endsWith('.css'))
  expect(files).toEqual(expect.arrayContaining(['admin/surface/newTest/newTest.css', 'testSurface/results/results.css', 'ui/ui.css', 'puck/editor/editor.css']))
  expect(files.length).toBeGreaterThan(10)
  for (const file of files) expect(bareSelectRules(readFileSync(new URL(file, root), 'utf8')), file).toEqual([])
})
test('bare-select scan catches both original collisions and ignores shared class selectors', () => {
  expect(bareSelectRules('.xp-new-test input:not([type=radio]), .xp-new-test textarea, .xp-new-test select { padding: .5rem; max-width: 36rem; }')).toEqual(['.xp-new-test select'])
  expect(bareSelectRules(':where(.xp-test-surface) .xp-round-meta select { width: auto; }')).toEqual([':where(.xp-test-surface) .xp-round-meta select'])
  expect(bareSelectRules('.xp-new-test .xp-ui-select-wrap, .xp-ui-select { max-width: 100%; }')).toEqual([])
})
