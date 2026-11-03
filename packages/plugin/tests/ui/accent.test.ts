import { expect, test } from 'vitest'
import { accentStyles, contrast, deriveAccent } from '../../src/ui/accent.js'
import { resolveOptions } from '../../src/options.js'
import { sampleOptions } from '../collections/fixtures.js'
test.each(['#1f3a68', '#888888', '#ffffff', '#000000', '#fff', '#000', '#136'])('accepts accessible fill %s in both themes', accent => {
  expect(resolveOptions({ ...sampleOptions(), theme: { accent } }).theme?.accent).toBe(accent)
  for (const [mode, set] of Object.entries(deriveAccent(accent))) {
    for (const fill of [set.accent, set.hover, set.active]) expect(contrast(set.fg, fill), `${mode} ${fill}`).toBeGreaterThanOrEqual(4.5)
    const surface = mode === 'light' ? '#ffffff' : '#222222'
    expect(contrast(set.focus, surface)).toBeGreaterThanOrEqual(3)
    expect(contrast(set.accentText, surface)).toBeGreaterThanOrEqual(4.5)
    expect(set.accentTextDecoration).toBe('none')
  }
})
test('refuses a midtone naming its colour and failing foreground ratio', () => {
  expect(() => resolveOptions({ ...sampleOptions(), theme: { accent: '#777777' } })).toThrow(/#777777: light foreground contrast 4\.48:1/)
})
test.each([undefined, '', '#fff'])('supports defaults and shorthand (%s)', accent => {
  expect(() => resolveOptions({ ...sampleOptions(), theme: { accent } })).not.toThrow()
  expect(deriveAccent('#136')).toEqual(deriveAccent('#113366'))
})
test.each([null, [], 'bad', { typo: '#fff' }, { accent: 'red' }, { accent: '#12345678' }, { accent: 12 }])('invalid theme rejected (%j)', theme => {
  expect(() => resolveOptions({ ...sampleOptions(), theme } as never)).toThrow(/theme/)
})
test('dark path raises HSL lightness to reach 3:1; derivation is opaque and deterministic', () => {
  const sets = deriveAccent('#000')
  expect(sets.light.accent).toBe('#000000')
  expect(sets.dark.accent).not.toBe(sets.light.accent)
  expect(contrast(sets.dark.accent, '#222222')).toBeGreaterThanOrEqual(3)
  expect(deriveAccent('#000')).toEqual(sets)
  for (const set of Object.values(sets)) {
    const { accentTextDecoration, ...colours } = set
    expect(accentTextDecoration).toBe('none')
    for (const value of Object.values(colours)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(contrast('#000', '#fff')).toBe(21)
})

test('focus darkens on a light surface and lightens on a dark surface', () => {
  const light = deriveAccent('#fff').light
  expect(light.focus).not.toBe(light.accent)
  expect(contrast(light.focus, '#000')).toBeLessThan(contrast(light.accent, '#000'))
  const dark = deriveAccent('#000').dark
  // The derived fill already reaches 3:1; the ring must preserve it, not darken it.
  expect(contrast(dark.focus, '#222222')).toBeGreaterThanOrEqual(3)
  expect(contrast(dark.focus, '#000')).toBeGreaterThanOrEqual(contrast(dark.accent, '#000'))
})
test('a light accent with dark foreground visibly lightens on hover and active', () => {
  for (const set of Object.values(deriveAccent('#dddddd'))) {
    expect(set.fg).toBe('#141414')
    expect(set.hover).not.toBe(set.accent)
    expect(contrast(set.hover, '#000')).toBeGreaterThan(contrast(set.accent, '#000'))
    expect(contrast(set.active, '#000')).toBeGreaterThan(contrast(set.hover, '#000'))
  }
})
test('custom dark-theme hover follows the lighter default direction even with white text', () => {
  const set = deriveAccent('#000').dark
  expect(set.fg).toBe('#ffffff')
  expect(set.hover).not.toBe(set.accent)
  expect(contrast(set.hover, '#000')).toBeGreaterThan(contrast(set.accent, '#000'))
  for (const fill of [set.hover, set.active]) expect(contrast(set.fg, fill)).toBeGreaterThanOrEqual(4.5)
})

test('host CSS publishes accessible text and decoration tokens for both themes', () => {
  const sets = deriveAccent('#1f3a68'), css = accentStyles('#1f3a68')!
  for (const set of Object.values(sets)) {
    expect(css).toContain(`--xp-accent-text:${set.accentText};`)
    expect(css).toContain(`--xp-accent-text-decoration:${set.accentTextDecoration};`)
  }
  expect(accentStyles()).toBeUndefined()
})
