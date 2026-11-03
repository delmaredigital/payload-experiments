export interface AccentSet { accent: string; hover: string; active: string; subtle: string; fg: string; focus: string }
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
function set(accent: string, surface: string): AccentSet {
  const fg = contrast(accent, '#ffffff') >= contrast(accent, '#141414') ? '#ffffff' : '#141414'
  // Keep one foreground across all interaction states. Clamp darkening near the
  // text-contrast boundary; a colour exactly at that boundary may stay unchanged.
  let low = 0, high = 0.24
  for (let i = 0; i < 24; i++) {
    const amount = (low + high) / 2
    if (contrast(mix(accent, '#000000', amount), fg) >= 4.5) low = amount
    else high = amount
  }
  const amount = contrast(mix(accent, '#000000', 0.24), fg) >= 4.5 ? 0.24 : low
  let focus = accent
  for (let step = 1; contrast(focus, surface) < 3 && step <= 1000; step++) focus = mix(accent, '#000000', step / 1000)
  return { accent, hover: mix(accent, '#000000', amount / 2), active: mix(accent, '#000000', amount),
    subtle: mix(surface, accent, 0.08), fg, focus }
}
/** Pure shared host-accent derivation. Reference surfaces match theme.css's Payload
 * 3.90.2 white / elevation-50 dark. Dark adjustment increases HSL lightness until
 * the quantised hex reaches 3:1. Hover/active darken up to 12/24%, clamped to preserve text contrast; subtle is 8% tint. */
export function deriveAccent(input: string): { light: AccentSet; dark: AccentSet } {
  const accent = hexOf(rgb(input))
  let dark = accent
  for (let step = 1; contrast(dark, '#222222') < 3 && step <= 1000; step++) dark = lighten(accent, step / 1000)
  return { light: set(accent, '#ffffff'), dark: set(dark, '#222222') }
}
/** Validated hex values only; specificity exceeds theme.css regardless of load order. */
export function accentStyles(input?: string): string | undefined {
  if (!input) return undefined
  const sets = deriveAccent(input)
  const declarations = (s: AccentSet) => Object.entries(s).map(([name, value]) => `--xp-${name === 'focus' ? name : name === 'accent' ? name : `accent-${name}`}:${value};`).join('')
  return `:root:root, [data-theme="light"][data-theme="light"]{${declarations(sets.light)}}\n[data-theme="dark"][data-theme="dark"]{${declarations(sets.dark)}}`
}
