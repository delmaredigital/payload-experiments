import { expect, test } from 'vitest'
import { contrast, deriveAccent } from '../../src/ui/accent.js'
import { resolveOptions } from '../../src/options.js'
import { sampleOptions } from '../collections/fixtures.js'
test.each(['#1f3a68', '#888888', '#ffffff', '#000000', '#fff', '#000', '#136'])('accepts accessible fill %s in both themes', accent => {
  expect(resolveOptions({ ...sampleOptions(), theme: { accent } }).theme?.accent).toBe(accent)
  for (const [mode, set] of Object.entries(deriveAccent(accent))) {
    for (const fill of [set.accent, set.hover, set.active]) expect(contrast(set.fg, fill), `${mode} ${fill}`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(set.focus, mode === 'light' ? '#ffffff' : '#222222')).toBeGreaterThanOrEqual(3)
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
    expect(contrast(set.hover, '#ffffff')).toBeGreaterThanOrEqual(contrast(set.accent, '#ffffff'))
    expect(contrast(set.active, '#ffffff')).toBeGreaterThanOrEqual(contrast(set.hover, '#ffffff'))
    for (const value of Object.values(set)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(contrast('#000', '#fff')).toBe(21)
})
