import { beforeAll, expect, test } from 'vitest'
import { accentStyles, contrast, deriveAccent, deriveAccentFor, validateAccent } from '../../src/ui/accent.js'
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
test('dark white-text fill switches direction when lightening cannot fit two visible steps', () => {
  const set = deriveAccent('#000').dark
  expect(set.fg).toBe('#ffffff')
  expect(set.hover).not.toBe(set.accent)
  expect(contrast(set.hover, '#000')).toBeLessThan(contrast(set.accent, '#000'))
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

test('#3377cc in dark has a visible hover at the foreground contrast limit', () => {
  const { accent, hover } = deriveAccent('#3377cc').dark
  expect(hover).not.toBe(accent)
  expect(contrast(hover, accent)).toBeGreaterThanOrEqual(1.1)
})

const grid: Array<{
  input: string
  sets: ReturnType<typeof deriveAccent>
  acceptedBefore: boolean
  validationThrew: boolean
  validationMessage: string
}> = []
beforeAll(() => {
  const started = performance.now()
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const input = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    const sets = deriveAccent(input)
    // Freeze the old acceptance rule independently of validateAccent's derivation.
    const acceptedBefore = Object.values(sets).every(set => Math.max(contrast(set.accent, '#ffffff'), contrast(set.accent, '#141414')) >= 4.5)
    let validationThrew = false, validationMessage = ''
    try { validateAccent(input) } catch (error) {
      validationThrew = true
      validationMessage = error instanceof Error ? error.message : String(error)
    }
    grid.push({ input, sets, acceptedBefore, validationThrew, validationMessage })
  }
  console.log(`accent grid beforeAll: ${Math.round(performance.now() - started)} ms`)
}, 30_000) // Measured locally: 7.24 s; 30 s cap exceeds the 3× hook-duration rule.

test.each([
  ['light', 3742, 161], ['dark', 2303, 1600],
] as const)('%s: 16-level RGB grid (17 channel increments), 3903 accepted; preferred %i, other %i, insufficient 0', (mode, preferredCount, otherCount) => {
  const counts = { accepted: 0, refused: 0, preferred: 0, other: 0 }
  const refusalViolations: string[] = [], unexpectedRefusals: string[] = [], lowContrastFills: string[] = [], insufficient: string[] = []
  for (const { input, sets, acceptedBefore, validationThrew, validationMessage } of grid) {
    if (!acceptedBefore) {
      if (!validationThrew || !/foreground contrast/.test(validationMessage)) refusalViolations.push(`${input}: ${validationThrew ? validationMessage : 'accepted'}`)
      counts.refused++
      continue
    }
    if (validationThrew) unexpectedRefusals.push(`${input}: ${validationMessage}`)
    counts.accepted++
    const set = sets[mode]
    const hoverStep = contrast(set.accent, set.hover), activeStep = contrast(set.hover, set.active)
    if (hoverStep < 1.1 || activeStep < 1.1) insufficient.push(input)
    for (const fill of [set.accent, set.hover, set.active]) if (contrast(fill, set.fg) < 4.5) lowContrastFills.push(`${input} ${mode} ${fill}`)
    const lightens = contrast(set.hover, '#000000') > contrast(set.accent, '#000000')
    counts[lightens === (mode === 'dark' || set.fg === '#141414') ? 'preferred' : 'other']++
  }
  console.log(`${mode}: ${JSON.stringify(counts)}; insufficient (${insufficient.length}): ${JSON.stringify(insufficient)}`)
  expect(refusalViolations, `${mode} old-rule refusals accepted or missing foreground contrast error: ${refusalViolations.join(', ')}`).toEqual([])
  expect(unexpectedRefusals, `${mode} old-rule accepted colours refused: ${unexpectedRefusals.join(', ')}`).toEqual([])
  expect(lowContrastFills, `${mode} fills below 4.5:1 foreground contrast: ${lowContrastFills.join(', ')}`).toEqual([])
  expect(insufficient, `${mode} colours without two 1.1:1 steps: ${insufficient.join(', ')}`).toEqual([])
  expect(counts).toEqual({ accepted: 3903, refused: 193, preferred: preferredCount, other: otherCount })
})

const originalFixtures = {
  "#3377cc": {
    "light": {
      "accent": "#3377cc",
      "hover": "#2d69b4",
      "active": "#275a9b",
      "subtle": "#eff4fb",
      "fg": "#ffffff",
      "focus": "#3377cc",
      "accentText": "#3377cc",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#3377cc",
      "hover": "#3377cc",
      "active": "#3477cc",
      "subtle": "#232930",
      "fg": "#ffffff",
      "focus": "#3377cc",
      "accentText": "#508bd3",
      "accentTextDecoration": "none"
    }
  },
  "#1f3a68": {
    "light": {
      "accent": "#1f3a68",
      "hover": "#1b335c",
      "active": "#182c4f",
      "subtle": "#edeff3",
      "fg": "#ffffff",
      "focus": "#1f3a68",
      "accentText": "#1f3a68",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#386abd",
      "hover": "#4070c0",
      "active": "#4976c3",
      "subtle": "#24282e",
      "fg": "#ffffff",
      "focus": "#386abd",
      "accentText": "#6189cb",
      "accentTextDecoration": "none"
    }
  },
  "#888888": {
    "light": {
      "accent": "#888888",
      "hover": "#969696",
      "active": "#a5a5a5",
      "subtle": "#f5f5f5",
      "fg": "#141414",
      "focus": "#888888",
      "accentText": "#767676",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#888888",
      "hover": "#969696",
      "active": "#a5a5a5",
      "subtle": "#2a2a2a",
      "fg": "#141414",
      "focus": "#888888",
      "accentText": "#898989",
      "accentTextDecoration": "none"
    }
  },
  "#ffffff": {
    "light": {
      "accent": "#ffffff",
      "hover": "#ffffff",
      "active": "#ffffff",
      "subtle": "#ffffff",
      "fg": "#141414",
      "focus": "#949494",
      "accentText": "#767676",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#ffffff",
      "hover": "#ffffff",
      "active": "#ffffff",
      "subtle": "#343434",
      "fg": "#141414",
      "focus": "#ffffff",
      "accentText": "#ffffff",
      "accentTextDecoration": "none"
    }
  },
  "#000000": {
    "light": {
      "accent": "#000000",
      "hover": "#000000",
      "active": "#000000",
      "subtle": "#ebebeb",
      "fg": "#ffffff",
      "focus": "#000000",
      "accentText": "#000000",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#6c6c6c",
      "hover": "#717171",
      "active": "#767676",
      "subtle": "#282828",
      "fg": "#ffffff",
      "focus": "#6c6c6c",
      "accentText": "#898989",
      "accentTextDecoration": "none"
    }
  },
  "#113366": {
    "light": {
      "accent": "#113366",
      "hover": "#0f2d5a",
      "active": "#0d274e",
      "subtle": "#eceff3",
      "fg": "#ffffff",
      "focus": "#113366",
      "accentText": "#113366",
      "accentTextDecoration": "none"
    },
    "dark": {
      "accent": "#2368d0",
      "hover": "#2d6fd2",
      "active": "#3775d4",
      "subtle": "#222830",
      "fg": "#ffffff",
      "focus": "#2368d0",
      "accentText": "#5389da",
      "accentTextDecoration": "none"
    }
  }
} as const
test.each(Object.entries(originalFixtures))('%s preserves every original token except hover/active', (input, original) => {
  for (const mode of ['light', 'dark'] as const) {
    const { hover: _hover, active: _active, ...before } = original[mode]
    const { hover, active, ...after } = deriveAccent(input)[mode]
    expect(after).toEqual(before)
    expect(contrast(after.accent, hover)).toBeGreaterThanOrEqual(1.1)
    expect(contrast(hover, active)).toBeGreaterThanOrEqual(1.1)
  }
})

test('injected reference surfaces reproduce the standard derivation', () => {
  expect(deriveAccentFor('#1f3a68', { light: '#ffffff', dark: '#222222' })).toEqual(deriveAccent('#1f3a68'))
})

test('accent text and focus fall back to the text token when no mix reaches the floor', () => {
  // Black or white always clears 4.5:1 and 3:1 on a real surface, so raise the floors past 21:1.
  const sets = deriveAccentFor('#3377cc', { light: '#ffffff', dark: '#222222' }, { text: 22, focus: 22 })
  for (const set of [sets.light, sets.dark]) {
    expect(set.accentText).toBe('var(--xp-text)')
    expect(set.accentTextDecoration).toBe('underline')
    expect(set.focus).toBe('var(--xp-text)')
  }
})
test('the default floors never take the fallback on the reference surfaces', () => {
  const sets = deriveAccentFor('#3377cc', { light: '#ffffff', dark: '#222222' })
  expect(sets.light.accentTextDecoration).toBe('none')
  expect(sets.dark.focus).not.toBe('var(--xp-text)')
})
