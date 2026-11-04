// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanup, render, waitFor } from '@testing-library/react'
import { ConfigProvider } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { ResultsRoute } from '../../src/admin/surface/ResultsRoute.js'
import type { SurfaceProps } from '../../src/admin/surface/contracts.js'
import type { ArmKey } from '../../src/types/contracts.js'
import type { TestDocument } from '../../src/admin/surface/testDocument.model.js'
import { fixture, phaseFor, revenueSnapshot } from '../../tests/admin/results/fixtures.js'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/experiments/fixture/results', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const cssPaths = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css'),
  join(src, 'admin/theme.css'), join(src, 'ui/ui.css'), join(src, 'admin/surface/surface.css'), join(src, 'admin/results/results.css')]
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' }, admin: { user: 'editors' } } as unknown as ClientConfig
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: true,
  flagPoints: [], attributeKeys: {}, metricSources: [] }

// Illustrative mockup values, only in this visual fixture. No inference is run here.
// A decided round shows the stored winner verdict (as the server writes it), with the fixture's arm labels.
function decisionSnapshot(base: ReturnType<typeof fixture>) {
  const stored = fixture('T7-bayesian').verdict
  const relabel = (text: string | null | undefined) => text?.replaceAll('Shorter form', 'Variant A') ?? text
  return { ...base, verdict: { ...stored, finding: relabel(stored.finding)!, headline: relabel(stored.headline)!, action: relabel(stored.action) ?? null, detail: relabel(stored.detail)! } }
}
function mockupSnapshot() {
  const snapshot = fixture('T7-bayesian')
  snapshot.window = { from: '2026-10-25T12:00:00Z', to: '2026-11-03T12:00:00Z' }
  snapshot.srm.expected = { control: 1 / 3, variantA: 1 / 3, variantB: 1 / 3 }
  snapshot.exposures.total = 1204
  snapshot.exposures.perArm = { control: 402, variantA: 401, variantB: 401 }
  snapshot.verdict.headline = 'Keep running to the planned end date.'
  snapshot.verdict.detail = 'About 19 more days.'
  const metric = snapshot.metrics[0]!
  metric.name = 'Donation completed'
  metric.perArm = [metric.perArm[0]!, metric.perArm[1]!, { ...metric.perArm[1]!, arm: 'variantB' }]
  metric.comparisons = [metric.comparisons[0]!, { ...metric.comparisons[0]!, arm: 'variantB' }]
  metric.perArm = metric.perArm.filter(arm => arm.arm !== 'holdout').map((arm, i) => ({ ...arm, n: i === 0 ? 402 : 401, converters: [29, 38, 31][i]!, mean: [29 / 402, 38 / 401, 31 / 401][i]! }))
  metric.comparisons = metric.comparisons.map((comparison, i) => ({ ...comparison, chanceToWin: i === 0 ? .71 : .18, lift: i === 0 ? .31 : .07, ci: i === 0 ? [-.08, .74] : [-.27, .45] }))
  const guardrail = snapshot.metrics.find(item => item.role === 'guardrail')!
  guardrail.name = 'Unsubscribed from emails'
  guardrail.perArm = metric.perArm.map((arm, i) => ({ ...arm, converters: 6, mean: [.015, .016, .014][i]! }))
  guardrail.comparisons = metric.comparisons.map((comparison, i) => ({ ...comparison, lift: i === 0 ? .04 : -.05, ci: i === 0 ? [-.38, .71] : [-.45, .60] }))
  const amounts = revenueSnapshot()
  const amount = amounts.metrics[0]!
  amount.name = 'Donation amount'
  amount.role = 'secondary'
  amount.perArm = metric.perArm.map((arm, i) => ({ ...arm, mean: [42.10, 44.80, 41.20][i]!, capped: { resolvedCap: 100, uncappedTotal: 20000, cappedCount: 1 } }))
  amount.comparisons = metric.comparisons.map((comparison, i) => ({ ...comparison, lift: i === 0 ? .06 : -.02, ci: i === 0 ? [-.19, .38] : [-.26, .30] }))
  snapshot.metrics.push(amount)
  snapshot.params.caps = amounts.params.caps
  return snapshot
}

test('writes real Shell and ResultsRoute scenarios in light and dark', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-03T12:00:00Z'))
  for (const path of cssPaths) readFileSync(path)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const state of ['running-leader', 'collecting', 'decided', 'archived-page', 'rollout', 'quality-watch', 'reader', 'released-page'] as const) {
    const snapshot = state === 'collecting' ? fixture('T4') : state === 'rollout' ? fixture('R3') : mockupSnapshot()
    const phase = phaseFor(snapshot)
    phase.startedAt = snapshot.window.from
    phase.arms = phase.arms.filter(arm => arm.key !== 'holdout' || state === 'rollout').map(arm => ({ ...arm, label: arm.key === 'control' ? 'Original' : arm.key === 'variantA' ? 'Variant A' : arm.key === 'variantB' ? 'Variant B' : arm.label }))
    if (state === 'quality-watch') snapshot.exposures.armMismatch = 2
    const archived = state === 'archived-page' || state === 'released-page'
    const decided = state === 'decided' || state === 'rollout' || archived
    const decisionPhase = state === 'rollout' ? 1 : phase.phase
    const doc: TestDocument = { id: state, name: archived ? 'Summer program landing page' : 'Registration donation ask', slug: state,
      kind: archived ? 'page' : 'block', status: archived ? 'archived' : decided ? 'decided' : 'running', unitType: 'visitor',
      phase: phase.phase, exposurePolicy: archived ? 'pageview' : 'render', allocation: 75, startedAt: phase.startedAt,
      decidedAt: decided ? snapshot.window.to : undefined, analysis: { plannedDurationDays: 28 },
      arms: phase.arms.map(arm => ({ ...arm, key: arm.key as ArmKey, weight: arm.key === 'control' ? 34 : 33, ...(archived ? { pageTarget: `/${arm.key}` } : { slot: arm.key as 'control' | 'variantA' | 'variantB' }) })),
      ...(decided ? { decision: { phase: decisionPhase, winnerArm: 'variantA', ...(state === 'released-page'
        ? { pagesReleasedAt: '2026-11-03T12:00:00Z', pagesReleasedBy: 'editor' } : {}) } } : {}) }
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/editors/') ? { name: 'Alex Editor' }
        : url.endsWith('/preflight') ? { checks: [], placements: [{ collection: 'pages', id: 1, title: 'Registration thank you', url: '/thank-you', ok: true }] }
          : url.includes('/xp-experiments/') ? doc
            : url.includes('/summary?') ? { [state]: { exposures: snapshot.exposures.total, days: 9, verdict: snapshot.verdict } }
              : { phases: state === 'rollout' ? [{ ...phase, phase: 1, phaseKind: 'test' }, phase] : [phase], snapshot, decision: doc.decision, decisionSnapshot: decided ? decisionSnapshot(snapshot) : undefined,
                series: ['2026-10-26', '2026-10-28', '2026-11-03'].flatMap(computedAt => ['variantA', 'variantB'].map((arm, i) => ({ computedAt, metricId: snapshot.metrics[0]!.metricId, arm, lift: i === 0 ? .31 : .07, ci: i === 0 ? [-.08, .74] : [-.27, .45] }))) },
    )))
    vi.stubGlobal('fetch', fetcher)
    const view = render(<ConfigProvider config={config}><ResultsRoute id={state} surface={{ ...surface, canManage: state !== 'reader' }} /></ConfigProvider>)
    await waitFor(() => expect(view.queryAllByRole('table').length).toBeGreaterThan(0))
    expect(view.getAllByRole('main')).toHaveLength(1)
    expect(view.container.querySelector<HTMLDetailsElement>('.xp-chart-details')?.open).toBe(false)
    if (state === 'archived-page') expect(view.getByRole('button', { name: 'Release pages' }).closest('header')).toBeTruthy()
    if (state === 'released-page') {
      await waitFor(() => expect(view.getByText('Pages released 3 Nov 2026 by Alex Editor')).toBeTruthy())
      expect(view.getByText('Pages released 3 Nov 2026 by Alex Editor').closest('.xp-tests-shell-subtitle')).toBeTruthy()
      expect(view.queryByRole('button', { name: 'Release pages' })).toBeNull()
    }
    if (state === 'reader') {
      expect(view.queryAllByRole('button')).toHaveLength(0)
      expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(false)
    }
    if (state === 'running-leader') await waitFor(() => expect(view.getByText('Running since 25 Oct 2026 · 1,204 people so far · about 19 days to go')).toBeTruthy())
    for (const theme of ['light', 'dark']) {
      const html = `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${state} results — ${theme}</title>${cssPaths.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join('')}<style>body { margin: 0; }</style></head><body>${view.container.innerHTML}</body></html>`
      const path = join(output, `results-${state}-${theme}.html`)
      writeFileSync(path, html); paths.push(path)
    }
    cleanup()
  }
  expect(paths).toHaveLength(16)
  console.log(paths.join('\n'))
})
