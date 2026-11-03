import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8')
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
function rule(selector: string): string {
  return rules.filter(m => m[1]!.trim().split(',').map(s => s.trim()).includes(selector)).map(m => m[2]).join('\n')
}

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
    for (const expected of ['width: 100%', 'max-width: 100%', 'min-width: 0', 'box-sizing: border-box']) {
      expect(declarations, `${selector}: ${expected}`).toContain(expected)
    }
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
  for (const selector of [".xp-ui-tab[aria-selected='true']", '.xp-ui-breadcrumb a', '.xp-ui-button--quiet', '.xp-ui-button--quiet:hover']) {
    expect(rule(selector), selector).toContain('color: var(--xp-accent-text)')
    expect(rule(selector), selector).toContain('text-decoration: var(--xp-accent-text-decoration)')
  }
  expect(rule('.xp-ui-status--running')).toContain('color: var(--xp-success)')
  expect(rule('.xp-ui-status--ready')).toContain('color: var(--xp-success)')
})
