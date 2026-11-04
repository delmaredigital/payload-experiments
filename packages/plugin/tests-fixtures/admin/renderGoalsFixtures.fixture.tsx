// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ConfigProvider } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { GoalForm } from '../../src/admin/surface/goals/GoalForm.js'
import { GoalsList } from '../../src/admin/surface/goals/GoalsList.js'
import type { Goal } from '../../src/admin/surface/goals/goals.model.js'
import type { SurfaceProps } from '../../src/admin/surface/contracts.js'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/experiments/goals', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const cssPaths = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css'),
  join(src, 'admin/theme.css'), join(src, 'ui/ui.css'), join(src, 'admin/surface/surface.css'), join(src, 'admin/surface/goals/goals.css')]
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' } } as unknown as ClientConfig
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: true,
  flagPoints: [], attributeKeys: {}, metricSources: [
    { id: 'donation', label: 'Donation completed', kind: 'binomial', keyedBy: 'visitor', clientWritable: false },
    { id: 'amount', label: 'Donation amount', kind: 'revenue', keyedBy: 'visitor', clientWritable: false },
    { id: 'unsubscribe', label: 'Unsubscribed from emails', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
    { id: 'visits', label: 'Pages visited', kind: 'count', keyedBy: 'visitor', clientWritable: true },
  ] }
const goals: Goal[] = [
  { id: 'donation', name: 'Donation completed', slug: 'donation-completed', source: 'donation', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150, guardrailThreshold: 0.05 },
  { id: 'amount', name: 'Donation amount', slug: 'donation-amount', source: 'amount', direction: 'increase' },
  { id: 'unsubscribe', name: 'Unsubscribed from emails', slug: 'unsubscribe', source: 'unsubscribe', direction: 'decrease' },
  { id: 'visits', name: 'Pages visited', slug: 'pages-visited', source: 'visits', direction: 'increase' },
]

test('writes real Shell and Goals pages in six states, each light and dark', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  for (const path of cssPaths) readFileSync(path)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const state of ['list', 'empty', 'return', 'new', 'used', 'threshold-error'] as const) {
    const form = state === 'new' || state === 'used' || state === 'threshold-error'
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/xp-experiments?')
      ? { docs: [{ id: 'test-1', metrics: { primary: 'donation', secondary: ['donation'], guardrails: ['donation'] } }] }
      : url.includes('/xp-metrics?') ? { docs: state === 'empty' ? [] : goals } : goals[0])))
    vi.stubGlobal('fetch', fetch)
    const view = render(<ConfigProvider config={config}>{form
      ? <GoalForm surface={surface} id={state === 'used' ? 'donation' : undefined} />
      : <GoalsList surface={surface} returnToTest={state === 'return' ? 'test-1' : undefined} />}</ConfigProvider>)
    if (form) await view.findByLabelText('Name')
    else await waitFor(() => expect(view.queryByText('Loading goals…')).toBeNull())
    if (state === 'threshold-error') {
      fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Donation completed' } })
      fireEvent.change(view.getByLabelText('Measured by'), { target: { value: 'donation' } })
      fireEvent.change(view.getByLabelText('Warn when it gets worse by (%)'), { target: { value: '-1' } })
      fireEvent.submit(view.getByRole('button', { name: 'Save' }).closest('form')!)
      expect(view.container.querySelector<HTMLDetailsElement>('details')!.open).toBe(true)
      expect(view.getByRole('alert').textContent).toContain('Enter a percentage')
      expect(fetch).not.toHaveBeenCalled()
    }
    if (state === 'used') {
      expect((view.getByLabelText('Short name') as HTMLInputElement).readOnly).toBe(true)
      expect((view.getByRole('button', { name: 'Delete goal' }) as HTMLButtonElement).disabled).toBe(true)
      expect(view.getByText('In use by 1 test')).toBeTruthy()
    }
    if (!form && state !== 'empty') expect(view.container.querySelectorAll('article')).toHaveLength(4)
    if (state === 'empty') expect(view.getByText('No goals yet. A goal is what a test tries to improve.')).toBeTruthy()
    if (state === 'return') {
      expect(view.getAllByRole('link', { name: 'Use this goal' })).toHaveLength(4)
      expect(view.getByRole('link', { name: 'Back to the test' })).toBeTruthy()
    }
    expect(view.getAllByRole('main')).toHaveLength(1)
    expect(view.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1)
    for (const theme of ['light', 'dark']) {
      view.container.querySelectorAll('option').forEach(option => option.toggleAttribute('selected', option.selected))
      const html = `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Goals ${state} — ${theme}</title>${cssPaths.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join('')}<style>body { margin: 0; }</style></head><body>${view.container.innerHTML}</body></html>`
      const path = join(output, `goals-${state}-${theme}.html`)
      writeFileSync(path, html); paths.push(path)
    }
    cleanup()
  }
  expect(paths).toHaveLength(12)
  console.log(paths.join('\n'))
})
