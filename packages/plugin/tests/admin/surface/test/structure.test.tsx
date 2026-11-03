// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Rail } from '../../../../src/admin/surface/test/Rail.js'
import { Section } from '../../../../src/admin/surface/test/Section.js'
import { ReadinessBar } from '../../../../src/admin/surface/test/ReadinessBar.js'
import { TestHeader } from '../../../../src/admin/surface/test/TestHeader.js'
import { props, preflight } from '../readiness/fixtures.js'

vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const bar = (p = props()) => <ReadinessBar {...p} onHeightChange={() => {}} />

test('rail has six marked jump links, a muted advanced item and a clicked-item fallback', () => {
  const p = props({}, { preflight: preflight([{ code: 'no-primary-metric', ok: false }]) })
  render(<Rail test={p.test} />)
  const links = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link')
  expect(links.map(link => link.getAttribute('href'))).toEqual(['what', 'versions', 'win', 'who', 'length', 'advanced'].map(id => `#section-${id}`))
  expect(links[0]!.textContent).toContain('✓Complete: ')
  expect(links[2]!.textContent).toContain('○Incomplete: ')
  expect(links[5]!.classList.contains('xp-test-rail-item--advanced')).toBe(true)
  expect(links[0]!.getAttribute('aria-current')).toBe('location')
  fireEvent.click(links[2]!)
  expect(links[2]!.getAttribute('aria-current')).toBe('location')
  expect(links[0]!.hasAttribute('aria-current')).toBe(false)
})
test('rail follows observed sections, disconnects and keeps the active mobile chip in view', () => {
  const observe = vi.fn(), disconnect = vi.fn(), scroll = vi.fn()
  let intersect!: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback }
    observe = observe; disconnect = disconnect
  })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  HTMLElement.prototype.scrollIntoView = scroll
  const p = props()
  const view = render(<><Section test={p.test} sectionId="what">What</Section><Section test={p.test} sectionId="versions">Versions body</Section><Rail test={p.test} /></>)
  expect(observe).toHaveBeenCalledTimes(2)
  act(() => intersect([{ target: document.getElementById('section-versions'), isIntersecting: true, intersectionRatio: .5 }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(screen.getByRole('link', { name: /^Complete:\s*Versions$/ }).getAttribute('aria-current')).toBe('location')
  expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' })
  act(() => intersect([{ target: document.getElementById('section-versions'), isIntersecting: false, intersectionRatio: 0 }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(screen.getByRole('link', { name: /^Complete:\s*Versions$/ }).hasAttribute('aria-current')).toBe(true)
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce()
})
test('mobile rail stays visible as a horizontally scrollable chip row at 960px', () => {
  const css = readFileSync(new NodeURL('../../../../src/admin/surface/test/testPage.css', import.meta.url), 'utf8')
  const mobile = css.slice(css.indexOf('@media (max-width: 960px)'))
  expect(mobile).toContain('.xp-test-rail-list { flex-direction: row; overflow-x: auto; }')
  expect(mobile).toContain('.xp-test-rail-item { white-space: nowrap; }')
  expect(mobile).not.toMatch(/display:\s*none/)
})
test.each([
  ['draft', ['Start']], ['stopped', ['Start a new round']],
  ['running', ['Stop', 'Add a goal', 'Let more people in']],
  ['decided', ['Make it the content', 'Discard winner']], ['archived', []],
] as const)('readiness bar selects the existing %s action set and ordering', (status, labels) => {
  const p = props({ status, decision: status === 'decided' ? { winnerArm: 'variantA' } : undefined })
  render(bar(p))
  expect(within(screen.getByRole('region', { name: 'Readiness' })).queryAllByRole('button').map(button => button.textContent)).toEqual(labels)
  if (status === 'running') expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull()
})
test('readiness bar links and focuses its blocking section heading; Advanced is collapsed', () => {
  const p = props({}, { preflight: preflight([{ code: 'no-primary-metric', ok: false }]) })
  render(<><Section test={p.test} sectionId="win">Choose a goal</Section><Section test={p.test} sectionId="advanced">Developer controls</Section>{bar(p)}</>)
  const scroll = vi.fn()
  document.getElementById('section-win')!.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('link', { name: 'Next: Choose a goal.' }))
  expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  expect(document.activeElement).toBe(document.getElementById('title-win'))
  expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  expect((document.getElementById('section-advanced') as HTMLDetailsElement).open).toBe(false)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Start' }).closest('[title]')?.getAttribute('title')).toBe('Choose a goal.')
})
test('header retains name editing and never contains Start; save state lives in the bar', () => {
  const p = props({}, { saving: 'saving' })
  const view = render(<TestHeader {...p} />)
  expect(screen.getByLabelText('Test name')).toBeTruthy()
  expect(view.container.querySelector('header button')).toBeNull()
  expect(screen.queryByText('Saving…')).toBeNull()
  view.rerender(bar(p))
  expect(screen.getByText('Saving…')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Start' }).closest('[title]')?.getAttribute('title')).toBe('Save your changes first.')
})
test('bar measures wrapped height and releases its resize observer', () => {
  const observe = vi.fn(), disconnect = vi.fn(), height = vi.fn()
  let resize!: ResizeObserverCallback
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback } observe = observe; disconnect = disconnect })
  const view = render(<ReadinessBar {...props()} onHeightChange={height} />)
  const node = screen.getByRole('region', { name: 'Readiness' })
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ height: 144 } as DOMRect)
  act(() => resize([], {} as ResizeObserver))
  expect(height).toHaveBeenLastCalledWith(144)
  expect(observe).toHaveBeenCalledWith(node)
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce()
})

test('setup-only clearance and header alignment do not apply to the results page', () => {
  const css = readFileSync(new NodeURL('../../../../src/admin/surface/test/testPage.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.xp-test-page--setup \{[^}]*padding: 0 0 160px/)
  expect(css).toMatch(/\.xp-test-page--setup > \.xp-test-header \{[^}]*max-width: 760px/)
  expect(css).not.toMatch(/\.xp-test-page > \.xp-test-header/)
})
