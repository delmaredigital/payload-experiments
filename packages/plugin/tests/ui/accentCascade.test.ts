// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { accentStyles } from '../../src/ui/accent.js'
afterEach(() => { document.head.innerHTML = ''; document.documentElement.removeAttribute('data-theme') })
test.each(['light', 'dark'] as const)('host %s accent wins even when theme.css loads later', mode => {
  document.documentElement.setAttribute('data-theme', mode)
  const theme = readFileSync(new NodeURL('../../src/admin/theme.css', import.meta.url), 'utf8')
  const host = document.createElement('style'); host.textContent = accentStyles('#1f3a68')!
  const base = document.createElement('style'); base.textContent = theme
  document.head.append(host, base)
  // jsdom does not implement selector specificity in its custom property cascade.
  // Compare matching selector specificity directly; the override has two classes/
  // pseudo-classes, theme.css has one, so source order cannot undo it.
  const matching = (text: string) => [...text.matchAll(/([^{}]+)\{[^{}]*--xp-accent:/g)].flatMap(m => m[1]!.trim().split(',')).map(s => s.trim()).filter(s => document.documentElement.matches(s))
  const specificity = (s: string) => (s.match(/\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length
  const overrides = matching(host.textContent)
  const defaults = matching(base.textContent)
  expect(overrides.length).toBeGreaterThan(0)
  expect(Math.min(...overrides.map(specificity))).toBeGreaterThan(Math.max(...defaults.map(specificity)))
})
