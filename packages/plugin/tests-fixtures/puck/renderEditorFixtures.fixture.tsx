// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { createExperimentSlotEditor } from '../../src/puck/editor/ExperimentSlotEditor.js'
import type { EditorExperiment } from '../../src/puck/editor/editor.model.js'

const fixture = vi.hoisted(() => ({
  doc: undefined as EditorExperiment | undefined,
  state: '', inEditor: false, stateIndex: 0, filled: false, drawer: false, theme: 'light' as 'light' | 'dark',
}))

// Static rendering cannot run effects. Seed the chrome's theme, loaded document,
// selected version and drawer state; keep the real dispatcher and other hooks.
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => {
    const index = fixture.inEditor ? fixture.stateIndex++ : -1
    const seeded = index === 0 ? fixture.theme : index === 1 ? { id: 1, doc: fixture.doc }
      : index === 2 && fixture.doc ? { id: 1, slot: 'variantA' }
      : index === 3 ? fixture.drawer
      : index === 8 && fixture.state === 'weights-invalid' ? { control: '60' }
      : index === 8 && fixture.doc && !['draft', 'stopped'].includes(fixture.doc.status) ? fixture.state === 'unavailable' ? 'unavailable'
        : { headline: fixture.state === 'collecting' ? 'Collecting' : 'Variant A is ahead', people: { control: 1234, variantA: 1456, variantB: 1302 } }
      : index === 14 && fixture.state === 'draft' ? true
      : index === 17 && fixture.state === 'remove' ? true : initial
    return react.useState(seeded)
  } }
})

// Same public-hook boundary as editorRender.test.tsx; no live Puck or API calls.
vi.mock('@puckeditor/core', async importOriginal => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const getItemById = () => ({ type: 'ExperimentSlot', props: {
    id: 'slot-1', control: fixture.filled ? [{ type: 'Text', props: { id: 'text-1' } }] : [],
    variantA: [], variantB: [], variantC: [],
  } })
  return {
    ...await importOriginal<typeof import('@puckeditor/core')>(),
    createUsePuck: () => (selector: (state: unknown) => unknown) => selector({
      selectedItem: getItemById(), getItemById,
      appState: { data: { root: { props: { title: 'September appeal' } } } },
    }),
    useGetPuck: () => () => ({ selectedItem: getItemById(), getItemById, dispatch: vi.fn(), getSelectorForId: vi.fn() }),
  }
})

const source = join(dirname(fileURLToPath(import.meta.url)), '../../src')

// Not part of the test suite: run by `pnpm fixtures:puck-editor` (vitest.fixtures.config.ts), which requires both env paths.
describe('editor visual fixtures (coordinator only)', () => {
  test('writes builder and readout states in light and dark, with host CSS first', () => {
    const output = process.env.XP_FIXTURE_OUT ?? ''
    const hostCss = process.env.XP_HOST_CSS
    if (!isAbsolute(output) || !hostCss || !isAbsolute(hostCss)) {
      throw new Error('XP_FIXTURE_OUT and XP_HOST_CSS must both be absolute paths')
    }
    readFileSync(hostCss) // Fail before writing if the supplied stylesheet is missing.
    mkdirSync(output, { recursive: true })
    const paths: string[] = []
    for (const state of ['unbound', 'draft', 'running', 'decided', 'drawer', 'accent', 'remove', 'weights-invalid', 'collecting', 'unavailable'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        fixture.state = state
        fixture.inEditor = true
        fixture.drawer = state === 'drawer'
        fixture.theme = theme
        fixture.stateIndex = 0
        fixture.filled = state !== 'unbound' && state !== 'drawer'
        fixture.doc = state === 'unbound' || state === 'drawer' ? undefined : { updatedAt: '2026-11-03T20:00:00.000Z', name: 'September appeal', status: ['running', 'collecting', 'unavailable'].includes(state) ? 'running' : state === 'decided' ? 'decided' : 'draft', decision: { winnerArm: 'variantA' }, arms: [
          { key: 'control', kind: 'control', label: 'Original', weight: 50, slot: 'control' },
          { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, slot: 'variantA' },
          ...(state === 'running' ? [{ key: 'variantB' as const, kind: 'variant' as const, label: 'Shorter appeal', weight: 0, slot: 'variantB' as const }] : []),
        ] }
        const Editor = createExperimentSlotEditor({ accent: state === 'accent' ? '#1f3a68' : undefined }).render
        const content = <Editor id="slot-1" experiment={fixture.doc ? { id: 1, slug: 'september-appeal' } : null}
              control={({ className }: { className?: string } = {}) => <div className={className}>{fixture.filled ? <article><h2>Support the September appeal</h2><p>Help students continue their education.</p></article> : null}</div>}
              variantA={({ className }: { className?: string } = {}) => <div className={className} />}
              variantB={({ className }: { className?: string } = {}) => <div className={className} />}
              variantC={({ className }: { className?: string } = {}) => <div className={className} />}
              puck={{ renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null }} />
        const page = '<!DOCTYPE html>' + renderToStaticMarkup(<html lang="en" className={theme === 'dark' ? 'dark' : undefined}>
          <head>
            <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>{`Experiment editor — ${state} — ${theme}`}</title>
            <link rel="stylesheet" href={pathToFileURL(hostCss).href} />
            <link rel="stylesheet" href={pathToFileURL(join(source, 'puck/editor/editor.css')).href} />
            <style>{`body { margin: 0; padding: 32px; background: ${theme === 'dark' ? '#141414' : '#fff'}; } main { max-width: 1100px; margin: auto; }`}</style>
          </head>
          <body><main>{content}</main>{state === 'drawer' || state === 'remove' ? <script dangerouslySetInnerHTML={{ __html: "const dialog = document.querySelector('dialog'); dialog.showModal(); (dialog.querySelector('[data-dialog-cancel]') || dialog.querySelector('input')).focus();" }} /> : null}</body>
        </html>)
        const path = join(output, `${state}-${theme}.html`)
        writeFileSync(path, page)
        paths.push(path)
      }
    }
    expect(paths).toHaveLength(20)
    expect(readFileSync(join(output, 'draft-light.html'), 'utf8')).toContain('Copy Original here')
    expect(readFileSync(join(output, 'remove-dark.html'), 'utf8')).toContain('Remove Variant A?')
    expect(readFileSync(join(output, 'weights-invalid-light.html'), 'utf8')).toContain('They add up to 110% now.')
    expect(readFileSync(join(output, 'running-dark.html'), 'utf8')).toContain('1,456 people')
    expect(readFileSync(join(output, 'collecting-light.html'), 'utf8')).toContain('Collecting')
    expect(readFileSync(join(output, 'unavailable-dark.html'), 'utf8')).toContain("Results aren&#x27;t available here.")
  })
})
