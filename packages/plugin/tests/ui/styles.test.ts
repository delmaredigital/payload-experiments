import { readFileSync } from 'node:fs'
import { referencePalette, resolvedTokens } from '../../../../scripts/generate-editor-css.mjs'
import { contrast } from '../../src/ui/accent.js'
import { expect, test } from 'vitest'

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8')
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
function rule(selector: string): string {
  return rules.filter(m => m[1]!.trim().split(',').map(s => s.trim()).includes(selector)).map(m => m[2]).join('\n')
}

test('page content stacks with a full-width picker, quiet disabled reasons and indented copy steps', () => {
  const page = readFileSync(new URL('../../src/admin/surface/test/testPage.css', import.meta.url), 'utf8') + readFileSync(new URL('../../src/admin/surface/pagePicker/pagePicker.css', import.meta.url), 'utf8')
  const declarations = (selector: string) => [...page.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(match => match[1]!.trim() === selector).map(match => match[2]).join('\n')
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
  const page = readFileSync(new URL('../../src/admin/surface/test/testPage.css', import.meta.url), 'utf8')
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
