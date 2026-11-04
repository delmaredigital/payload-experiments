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
import type { TestDocument } from '../../src/admin/surface/testDocument.model.js'
import { fixture, phaseFor } from '../../tests/admin/results/fixtures.js'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/experiments/fixture/results', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const cssPaths = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css'),
  join(src, 'admin/theme.css'), join(src, 'ui/ui.css'), join(src, 'admin/surface/surface.css'), join(src, 'admin/surface/test/testPage.css')]
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' }, admin: { user: 'editors' } } as unknown as ClientConfig
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: true,
  flagPoints: [], attributeKeys: {}, metricSources: [] }

test('writes archived page results with Release pages and the released line in both themes', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  for (const path of cssPaths) readFileSync(path)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const state of ['archived-page', 'released-page'] as const) {
    const snapshot = fixture('T7')
    const phase = { ...phaseFor(snapshot), endedAt: snapshot.window.to }
    const doc: TestDocument = { id: state, name: 'Summer program landing page', slug: state, kind: 'page', status: 'archived', unitType: 'visitor',
      phase: phase.phase, exposurePolicy: 'pageview', allocation: 100,
      arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/summer' },
        { key: 'variantA', kind: 'variant', label: 'Shorter page', weight: 50, pageTarget: '/summer-short' }],
      decision: { phase: phase.phase, winnerArm: 'variantA', ...(state === 'released-page'
        ? { pagesReleasedAt: '2026-11-03T12:00:00Z', pagesReleasedBy: 'editor' } : {}) } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/editors/') ? { name: 'Alex Editor' }
        : url.endsWith('/preflight') ? { checks: [], placements: [] }
          : url.includes('/xp-experiments/') ? doc
            : url.includes('/summary?') ? { [state]: { exposures: snapshot.exposures.total, days: 28, verdict: snapshot.verdict } }
              : { phases: [phase], snapshot, decision: doc.decision },
    ))))
    const view = render(<ConfigProvider config={config}><ResultsRoute id={state} surface={surface} /></ConfigProvider>)
    await waitFor(() => expect(view.queryByText('Loading test…')).toBeNull())
    await waitFor(() => expect(view.queryAllByRole('table').length).toBeGreaterThan(0))
    if (state === 'archived-page') expect(view.getByRole('button', { name: 'Release pages' })).toBeTruthy()
    else {
      await waitFor(() => expect(view.getByText('Pages released 3 Nov 2026 by Alex Editor')).toBeTruthy())
      expect(view.queryByRole('button', { name: 'Release pages' })).toBeNull()
    }
    for (const theme of ['light', 'dark']) {
      const html = `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${state} results — ${theme}</title>${cssPaths.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join('')}<style>body { margin: 0; }</style></head><body>${view.container.innerHTML}</body></html>`
      const path = join(output, `results-${state}-${theme}.html`)
      writeFileSync(path, html); paths.push(path)
    }
    cleanup()
  }
  expect(paths).toHaveLength(4)
  console.log(paths.join('\n'))
})
