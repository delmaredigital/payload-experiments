// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
import { Puck, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../src/puck/editor/ExperimentSlotEditor.js'
import { experimentOutlinePlugin } from '../../src/puck/editor/experimentOutlinePlugin.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('writes the real outline beside two-arm and orphan blocks, in both themes with host CSS', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  const hostCss = process.env.XP_HOST_CSS ?? ''
  if (!isAbsolute(output) || !isAbsolute(hostCss)) throw new Error('XP_FIXTURE_OUT and XP_HOST_CSS must both be absolute paths')
  readFileSync(hostCss)
  mkdirSync(output, { recursive: true })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  vi.stubGlobal('CSS', { escape: (id: string) => id }) // Fixture ids contain only identifier characters.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'September appeal', status: 'draft', arms: [
    { key: 'control', label: 'Original', kind: 'control' }, { key: 'variantA', label: 'Variant A', kind: 'variant' },
  ] }) }))
  const config: Config = { components: {
    ExperimentSlot: ExperimentSlotEditor,
    Text: { render: () => <p>Content kept in Variant C</p> },
  } }
  const data: Data = { root: { props: {} }, content: ['two-arm', 'orphan'].map(id => ({ type: 'ExperimentSlot', props: {
    id, experiment: { id: 'fixture-test', slug: 'september-appeal' }, control: [], variantA: [], variantB: [],
    variantC: id === 'orphan' ? [{ type: 'Text', props: { id: 'orphan-text' } }] : [],
  } })) }
  const view = render(<Puck config={config} data={data} plugins={[experimentOutlinePlugin()]}
    iframe={{ enabled: false }} ui={{ itemExpanded: { 'two-arm': true, orphan: true } }}>
    <div className="fixture-layout"><aside><Puck.Outline /></aside><main><Puck.Preview /></main></div>
  </Puck>)
  await screen.findByText("Variant C has content but isn't part of this test. Move or delete it; visitors never see it.")
  const source = join(dirname(fileURLToPath(import.meta.url)), '../../src')
  const require = createRequire(import.meta.url)
  const payloadEntry = require.resolve('@payloadcms/ui')
  const payloadCss = join(payloadEntry.slice(0, payloadEntry.lastIndexOf('/dist/') + 5), 'styles.css')
  const adminCss = require.resolve('@payloadcms/next/css')
  for (const path of [payloadCss, adminCss]) readFileSync(path)
  const coreCss = readFileSync(require.resolve('@puckeditor/core/puck.css'), 'utf8')
  const themeCss = readFileSync(join(source, 'admin/theme.css'), 'utf8')
  for (const theme of ['light', 'dark']) {
    writeFileSync(join(output, `outline-${theme}.html`), `<!DOCTYPE html><html lang="en" data-theme="${theme}" class="${theme}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Puck outline — ${theme}</title>
      <link rel="stylesheet" href="${pathToFileURL(hostCss).href}">
      <link rel="stylesheet" href="${pathToFileURL(adminCss).href}">
      <link rel="stylesheet" href="${pathToFileURL(payloadCss).href}">
      <style>${coreCss}\n${themeCss}</style>
      <link rel="stylesheet" href="${pathToFileURL(join(source, 'puck/editor/editor.css')).href}">
      <style>body { margin: 0; padding: 32px; background: var(--xp-bg); color: var(--xp-text); font-family: var(--xp-font-body); }
      .fixture-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 32px; } main { display: grid; gap: 32px; }</style>
      </head><body>${view.container.innerHTML}</body></html>`)
  }
  expect(view.container.querySelectorAll('li[data-puck-layer-tree-id]')).toHaveLength(3)
})
