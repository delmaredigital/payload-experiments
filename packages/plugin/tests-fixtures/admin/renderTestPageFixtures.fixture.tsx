// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ConfigProvider } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { TestPage } from '../../src/admin/surface/test/TestPage.js'
import type { SurfaceProps } from '../../src/admin/surface/contracts.js'
import type { TestDocument } from '../../src/admin/surface/testDocument.model.js'
import type { PreflightResult } from '../../src/types/endpoints.js'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/experiments/fixture', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const cssPaths = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css'),
  join(src, 'admin/theme.css'), join(src, 'ui/ui.css'), join(src, 'admin/surface/surface.css'),
  join(src, 'admin/surface/test/testPage.css'), join(src, 'admin/surface/setting/setting.css')]
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' } } as unknown as ClientConfig
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: true,
  flagPoints: [{ id: 'upsell', label: 'Recurring upsell', description: 'Offer a recurring gift after registration.',
    params: { message: { type: 'select', label: 'Message', options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }] } },
    defaultParams: { message: 'show' }, effectiveDefaults: { message: 'show' } }],
  attributeKeys: { path: { type: 'string' } },
  metricSources: [{ id: 'donation', label: 'Donation completed', kind: 'binomial', keyedBy: 'visitor', clientWritable: false },
    { id: 'amount', label: 'Donation amount', kind: 'revenue', keyedBy: 'visitor', clientWritable: false },
    { id: 'unsubscribe', label: 'Unsubscribed from emails', kind: 'binomial', keyedBy: 'visitor', clientWritable: true }],
}
const base: TestDocument = {
  id: 'fixture', name: 'Registration donation ask', slug: 'registration-donation-ask', kind: 'block', status: 'draft', unitType: 'visitor',
  allocation: 100, exposurePolicy: 'render', updatedAt: '2026-11-03T12:00:00.000Z',
  hypothesis: 'We believe a short, specific ask right after registration will raise donations because the moment is warm and the form is already complete.',
  arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 34, slot: 'control' },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 33, slot: 'variantA' },
    { key: 'variantB', kind: 'variant', label: 'Variant B', weight: 33, slot: 'variantB' }],
  metrics: { primary: 1, secondary: [2], guardrails: [3] },
  targeting: [{ attribute: 'path', op: 'in', value: ['/registration/thank-you', '/registration/thank-you-oauth'] }],
  analysis: { plannedDurationDays: 28, reachPerDay: 140, minExposuresPerArm: 200 },
}
const preflight: PreflightResult = { checks: [], placements: [{ collection: 'pages', id: 1, title: 'Registration thank-you', detail: 'Published', ok: true,
  editorUrl: '/admin/collections/pages/1', slots: { control: 1, variantA: 1, variantB: 1, variantC: 0 } }],
  baseline: { metricId: 1, value: .032, days: 28 }, trafficPerDay: 140,
  estimate: { weeks: 3.4, plannedDurationDays: 24, sequentialTuningParameter: 5000, feasible: true } }
const metrics = [{ id: 1, name: 'Donation completed', source: 'donation' }, { id: 2, name: 'Donation amount', source: 'amount' },
  { id: 3, name: 'Unsubscribed from emails', source: 'unsubscribe' }]

test('writes real Shell/TestPage fixtures for ready, blocked, running, page, setting and stale in both themes', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  for (const path of cssPaths) readFileSync(path)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const state of ['block-ready', 'block-blocked', 'block-running', 'page', 'setting', 'stale', 'threshold-error', 'missing-goal'] as const) {
    const doc: TestDocument = { ...base, id: state,
      ...(state === 'block-running' ? { status: 'running', startedAt: '2026-10-25T12:00:00Z', allocation: 40 } : {}),
      ...(state === 'missing-goal' ? { metrics: { ...base.metrics, primary: 99 } } : {}),
      ...(state === 'block-blocked' ? { metrics: { ...base.metrics, primary: null } } : {}),
      ...(state === 'page' ? { kind: 'page', name: 'Summer program landing page', exposurePolicy: 'pageview',
        arms: base.arms.map((arm, i) => ({ ...arm, slot: undefined, pageTarget: ['/summer', '/summer-a', '/summer-b'][i] })) } : {}),
      ...(state === 'setting' ? { kind: 'flag', name: 'Recurring upsell', exposurePolicy: 'manual', flagPoint: 'upsell',
        arms: base.arms.slice(0, 2).map((arm, i) => ({ ...arm, slot: undefined, weight: 50, params: { message: i ? 'hide' : 'show' } })) } : {}),
    }
    const check = { ...preflight, checks: state === 'block-blocked' || state === 'missing-goal' ? [{ code: 'no-primary-metric' as const, ok: false }] : [] }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
      init?.method === 'PATCH' && state === 'threshold-error' ? { errors: [{ data: { errors: [{ path: 'analysis.minExposuresPerArm', message: 'Enter a minimum of one person per version.' }] } }] } : init?.method === 'PATCH' ? { errors: [{ code: 'stale-edit', message: 'Someone else changed this test. Reload to see their changes.' }] }
        : url.endsWith('/preflight') ? check : url.includes('/xp-metrics') ? { docs: metrics, hasNextPage: false }
          : url.includes('/summary?') ? { [state]: { exposures: 1204, days: 9, verdict: null } } : doc,
    ), { status: init?.method === 'PATCH' ? state === 'threshold-error' ? 400 : 409 : 200 })))
    const view = render(<ConfigProvider config={config}><TestPage id={state} surface={surface} /></ConfigProvider>)
    await waitFor(() => expect(view.queryByText('Loading test…')).toBeNull())
    await waitFor(() => expect(view.queryByText('Loading metrics…')).toBeNull())
    await waitFor(() => expect(view.queryAllByText('Donation completed · yes/no').length).toBeGreaterThan(0))
    if (state === 'block-running') await waitFor(() => expect(view.getByText(/1,204 people so far/)).toBeTruthy())
    if (state === 'threshold-error') {
      fireEvent.click(view.getByRole('heading', { name: 'Advanced settings · for developers' }))
      fireEvent.change(view.getByLabelText('Minimum people per version'), { target: { value: '5' } })
      fireEvent.blur(view.getByLabelText('Minimum people per version'))
      // Close while the server validation is pending: the error must reopen it.
      view.container.querySelector<HTMLDetailsElement>('.xp-test-advanced')!.open = false
      await waitFor(() => expect(view.getByText('Enter a minimum of one person per version.')).toBeTruthy())
    }
    if (state === 'stale') {
      fireEvent.change(view.getByLabelText('Test name'), { target: { value: 'My unsaved name' } })
      fireEvent.blur(view.getByLabelText('Test name'))
      await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Someone else changed'))
    }
    await act(async () => {})
    expect(view.container.querySelectorAll('.xp-ui-section')).toHaveLength(5)
    expect(view.getAllByRole('main')).toHaveLength(1)
    expect(view.container.querySelector('.xp-test-advanced')?.hasAttribute('open')).toBe(state === 'threshold-error')
    for (const theme of ['light', 'dark']) {
      // jsdom has no layout. Real browser ResizeObserver measures the same fixed bar;
      // restore the conservative CSS fallback for the non-hydrated review fixture.
      const page = view.container.querySelector<HTMLElement>('.xp-test-page')!
      page.style.removeProperty('padding-bottom')
      const html = `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${state} — ${theme}</title>${cssPaths.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join('')}<style>body { margin: 0; }</style></head><body>${view.container.innerHTML}</body></html>`
      const path = join(output, `test-${state}-${theme}.html`)
      writeFileSync(path, html); paths.push(path)
    }
    cleanup()
  }
  expect(paths).toHaveLength(16)
  console.log(paths.join('\n'))
})
