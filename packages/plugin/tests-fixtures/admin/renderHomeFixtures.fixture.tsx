// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ConfigProvider } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { TestsHome } from '../../src/admin/surface/TestsHome.js'
import type { HomeTest } from '../../src/admin/surface/home.model.js'
import type { SummaryResponse } from '../../src/types/endpoints.js'

// Static HTML has no Next router. Keep the real Payload Link and plugin UI.
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/experiments', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const cssPaths = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css'),
  join(src, 'admin/theme.css'), join(src, 'ui/ui.css'), join(src, 'admin/surface/surface.css')]
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' } } as unknown as ClientConfig
const docs: HomeTest[] = [
  { id: 'hero', name: 'Course catalogue hero image', kind: 'block', unitType: 'visitor', status: 'running', analysis: { plannedDurationDays: 28 } },
  { id: 'donation', name: 'Registration donation ask', kind: 'block', unitType: 'visitor', status: 'running', analysis: { plannedDurationDays: 28 } },
  { id: 'apply', name: 'Apply page button wording', kind: 'flag', unitType: 'visitor', status: 'draft' },
  { id: 'summer', name: 'Summer program landing page', kind: 'page', unitType: 'visitor', status: 'draft' },
  { id: 'chapel', name: 'Chapel livestream banner', kind: 'block', unitType: 'visitor', status: 'draft' },
  { id: 'info', name: 'Request info form length', kind: 'flag', unitType: 'visitor', status: 'decided', decidedAt: '2026-10-12T12:00:00Z',
    arms: [{ key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50 }], decision: { winnerArm: 'variantA' } },
  { id: 'video', name: 'Homepage video autoplay', kind: 'block', unitType: 'visitor', status: 'archived' },
  { id: 'giving', name: 'Giving Tuesday headline', kind: 'block', unitType: 'visitor', status: 'archived' },
]
const summaries: SummaryResponse = {
  hero: { days: 31, exposures: 2940, verdict: { code: 'collecting', headline: 'Collecting data' } },
  donation: { days: 9, exposures: 1204, verdict: { code: 'collecting', headline: 'Collecting data' } },
  apply: { days: 0, exposures: 0, verdict: null, ready: true },
  summer: { days: 0, exposures: 0, verdict: null, ready: false, next: { code: 'no-primary-metric' } },
  chapel: { days: 0, exposures: 0, verdict: null, ready: false, next: { code: 'no-placements' } },
}

test('writes the real home and shell, empty and search-empty fixtures', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  for (const path of cssPaths) readFileSync(path)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const state of ['home', 'home-250', 'home-250-bottom', 'home-empty', 'home-search-empty'] as const) {
    const rows: HomeTest[] = state === 'home-empty' ? [] : state.startsWith('home-250')
      ? Array.from({ length: 250 }, (_, index) => ({ id: `test-${index + 1}`, name: `Test ${String(index + 1).padStart(3, '0')}`, kind: 'block', unitType: 'visitor', status: 'draft' })) : docs
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
      return new Response(JSON.stringify(url.includes('/summary?') ? summaries
        : { docs: rows.slice((page - 1) * 100, page * 100), hasNextPage: page * 100 < rows.length }))
    }))
    const view = render(<ConfigProvider config={config}><TestsHome adminRoute="/admin" apiRoute="/api" canManage /></ConfigProvider>)
    await waitFor(() => expect(view.queryByText('Loading tests…')).toBeNull())
    if (state === 'home-empty') expect(view.getByText('Create a test to learn what works.')).toBeTruthy()
    else expect(view.container.querySelectorAll('article')).toHaveLength(state.startsWith('home-250') ? 250 : 8)
    if (state.startsWith('home-250')) { expect(view.getByText('Test 001')).toBeTruthy(); expect(view.getByText('Test 250')).toBeTruthy() }
    if (state === 'home') {
      expect(view.getByText('Next: Choose a goal.')).toBeTruthy()
      expect(view.getByText('Next: Not on a page yet. Open a page, add an Experiment block and choose this test.')).toBeTruthy()
    }
    if (state === 'home-search-empty') {
      fireEvent.change(view.getByRole('searchbox'), { target: { value: 'newsletter' } })
      expect(view.getByText('No tests match "newsletter".')).toBeTruthy()
    }
    if (state === 'home-250-bottom') view.getByText('Test 250').closest('article')!.id = 'last-test'
    for (const theme of state === 'home-search-empty' ? ['light'] : ['light', 'dark']) {
      view.container.querySelectorAll('option').forEach(o => o.toggleAttribute('selected', o.selected))
      const html = `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tests — ${theme}</title>${cssPaths.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join('')}<style>body { margin: 0; }</style></head><body>${view.container.innerHTML}${state === 'home-250-bottom' ? '<script>document.getElementById("last-test").scrollIntoView({ block: "end" });</script>' : ''}</body></html>`
      const path = join(output, `${state}-${theme}.html`)
      writeFileSync(path, html)
      paths.push(path)
    }
    cleanup()
  }
  expect(paths).toHaveLength(9)
  console.log(paths.join('\n'))
})
