export interface AccentSet { accent: string; hover: string; active: string; subtle: string; fg: string; focus: string; accentText: string; accentTextDecoration: 'none' | 'underline' }
type RGB = [number, number, number]
function rgb(hex: string): RGB {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) throw new Error(`Invalid accent hex colour: ${hex}`)
  const full = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1)
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as RGB
}
const hexOf = (values: RGB) => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
function luminance(hex: string): number {
  const channels = rgb(hex).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}
/** WCAG 2.x relative luminance contrast. */
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function mix(a: string, b: string, amount: number): string {
  const x = rgb(a), y = rgb(b)
  return hexOf(x.map((v, i) => v * (1 - amount) + y[i]! * amount) as RGB)
}
/** Raise HSL lightness with hue and saturation fixed, including achromatic inputs. */
function lighten(hex: string, amount: number): string {
  const channels = rgb(hex).map(v => v / 255) as RGB
  const max = Math.max(...channels), min = Math.min(...channels), l = (max + min) / 2
  const next = l + (1 - l) * amount
  const scale = l === 1 ? 0 : (1 - Math.abs(2 * next - 1)) / (1 - Math.abs(2 * l - 1) || 1)
  return hexOf(channels.map(v => (next + (v - l) * scale) * 255) as RGB)
}
/** Bounded, quantised search toward the surface's opposite. */
function againstSurface(accent: string, surface: string, minimum: number): string | undefined {
  const opposite = luminance(surface) > 0.179 ? '#000000' : '#ffffff'
  for (let step = 0; step <= 1000; step++) {
    const candidate = mix(accent, opposite, step / 1000)
    if (contrast(candidate, surface) >= minimum) return candidate
  }
  return undefined
}
type Interaction = Pick<AccentSet, 'hover' | 'active'>
const interactionStep = (accent: string, states: Interaction) => Math.min(contrast(accent, states.hover), contrast(states.hover, states.active))
/** Keep the old 12/24% steps when visible, otherwise search the full direction. */
function interaction(accent: string, fg: string, target: string): Interaction {
  let low = 0, high = 0.24
  for (let i = 0; i < 24; i++) {
    const amount = (low + high) / 2
    if (contrast(mix(accent, target, amount), fg) >= 4.5) low = amount
    else high = amount
  }
  const amount = contrast(mix(accent, target, 0.24), fg) >= 4.5 ? 0.24 : low
  const original = { hover: mix(accent, target, amount / 2), active: mix(accent, target, amount) }
  if (interactionStep(accent, original) >= 1.1) return original

  const candidates = [accent]
  let hover: string | undefined
  for (let step = 1; step <= 1000; step++) {
    const candidate = mix(accent, target, step / 1000)
    if (contrast(candidate, fg) < 4.5) break
    candidates.push(candidate)
    if (!hover && contrast(accent, candidate) >= 1.1) hover = candidate
    else if (hover && contrast(hover, candidate) >= 1.1) return { hover, active: candidate }
  }
  // If two full steps cannot fit, maximise the smaller step to the last safe fill.
  const active = candidates[candidates.length - 1]!
  return candidates.reduce<Interaction>((best, candidate) => {
    const next = { hover: candidate, active }
    return interactionStep(accent, next) > interactionStep(accent, best) ? next : best
  }, { hover: accent, active })
}
/** Contrast floors for accent text and focus rings. Black or white always clears them on a real
 * surface, so the fallbacks below are defensive; tests raise the floors to exercise them. */
type Floors = { text: number; focus: number }
const FLOORS: Floors = { text: 4.5, focus: 3 }
function set(accent: string, surface: string, dark = false, floors: Floors = FLOORS): AccentSet {
  const fg = contrast(accent, '#ffffff') >= contrast(accent, '#141414') ? '#ffffff' : '#141414'
  const target = dark || fg === '#141414' ? '#ffffff' : '#000000'
  const preferred = interaction(accent, fg, target)
  const other = interaction(accent, fg, target === '#ffffff' ? '#000000' : '#ffffff')
  const states = interactionStep(accent, preferred) >= 1.1 || interactionStep(accent, preferred) >= interactionStep(accent, other) ? preferred : other
  const accentText = againstSurface(accent, surface, floors.text)
  return { accent, ...states,
    subtle: mix(surface, accent, 0.08), fg, focus: againstSurface(accent, surface, floors.focus) ?? 'var(--xp-text)',
    accentText: accentText ?? 'var(--xp-text)', accentTextDecoration: accentText ? 'none' : 'underline' }
}
/** Pure shared host-accent derivation using theme.css's reference surfaces. */
export function deriveAccent(input: string): { light: AccentSet; dark: AccentSet } {
  return deriveAccentFor(input, { light: '#ffffff', dark: '#222222' })
}
/** Module-only surface injection; not a package API. Dark adjustment raises HSL
 * lightness to 3:1. Interaction steps preserve the foreground and prefer the
 * original direction when both steps reach 1.1:1; subtle remains an 8% tint. */
export function deriveAccentFor(input: string, surfaces: { light: string; dark: string }, floors: Floors = FLOORS): { light: AccentSet; dark: AccentSet } {
  const accent = hexOf(rgb(input))
  let dark = accent
  for (let step = 1; contrast(dark, surfaces.dark) < 3 && step <= 1000; step++) dark = lighten(accent, step / 1000)
  return { light: set(accent, surfaces.light, false, floors), dark: set(dark, surfaces.dark, true, floors) }
}
/** Validated hex values only; specificity exceeds theme.css regardless of load order. */
export function accentStyles(input?: string): string | undefined {
  if (!input) return undefined
  const sets = deriveAccent(input)
  const declarations = (s: AccentSet) => Object.entries(accentVariables(s)).map(([name, value]) => `${name}:${value};`).join('')
  return `:root:root, [data-theme="light"][data-theme="light"]{${declarations(sets.light)}}\n[data-theme="dark"][data-theme="dark"]{${declarations(sets.dark)}}`
}

/** The plugin and Puck factory accept exactly the same host accent. */
export function validateAccent(accent: unknown): void {
  if (accent === undefined || accent === '') return
  if (typeof accent !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) throw new Error('Experiments theme.accent must be a CSS hex colour (#rgb or #rrggbb)')
  for (const [mode, set] of Object.entries(deriveAccent(accent))) {
    const ratio = contrast(set.accent, set.fg)
    if (ratio < 4.5) throw new Error(`Experiments theme.accent ${accent}: ${mode} foreground contrast ${ratio.toFixed(2)}:1 is below 4.5:1`)
  }
}

/** Inline variables use the same names as the admin accent stylesheet. */
export function accentVariables(set: AccentSet): Record<string, string> {
  return Object.fromEntries(Object.entries(set).map(([name, value]) => [
    `--xp-${name === 'accentText' ? 'accent-text' : name === 'accentTextDecoration' ? 'accent-text-decoration' : name === 'focus' || name === 'accent' ? name : `accent-${name}`}`, value,
  ]))
}
