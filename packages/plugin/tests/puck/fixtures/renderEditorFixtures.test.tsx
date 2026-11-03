// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { CreateExperimentDrawer } from '../../../src/puck/editor/CreateExperimentDrawer.js'
import type { EditorExperiment } from '../../../src/puck/editor/editor.model.js'

const fixture = vi.hoisted(() => ({
  doc: undefined as EditorExperiment | undefined,
  inEditor: false, stateIndex: 0, filled: false,
}))

// Static rendering cannot run the editor's fetch effect. Seed only its loaded
// document state; keep the real React dispatcher and all other state/hooks.
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => {
    const index = fixture.inEditor ? fixture.stateIndex++ : -1
    const seeded = index === 0 ? { id: 1, doc: fixture.doc }
      : index === 1 && fixture.doc?.status === 'running' ? { id: 1, slot: 'variantA' } : initial
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

const source = join(dirname(fileURLToPath(import.meta.url)), '../../../src')

describe.skipIf(!process.env.XP_FIXTURE_OUT)('editor visual fixtures (coordinator only)', () => {
  test('writes four editor states in light and dark, with host CSS first', () => {
    const output = process.env.XP_FIXTURE_OUT!
    const hostCss = process.env.XP_HOST_CSS
    if (!isAbsolute(output) || !hostCss || !isAbsolute(hostCss)) {
      throw new Error('XP_FIXTURE_OUT and XP_HOST_CSS must both be absolute paths')
    }
    readFileSync(hostCss) // Fail before writing if the supplied stylesheet is missing.
    mkdirSync(output, { recursive: true })
    const Editor = ExperimentSlotEditor.render
    const paths: string[] = []
    for (const state of ['draft-empty', 'draft-filled', 'running', 'drawer'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        fixture.inEditor = state !== 'drawer'
        fixture.stateIndex = 0
        fixture.filled = state !== 'draft-empty'
        fixture.doc = { name: 'September appeal', status: state === 'running' ? 'running' : 'draft', arms: [
          { key: 'control', kind: 'control', label: 'Original' },
          { key: 'variantA', kind: 'variant', label: 'Variant A' },
          { key: 'variantB', kind: 'variant', label: 'Variant B' },
        ] }
        const content = state === 'drawer'
          ? <CreateExperimentDrawer initialName="September appeal" onCreate={() => {}} onClose={() => {}} />
          : <Editor id="slot-1" experiment={{ id: 1, slug: 'september-appeal' }}
              control={({ className }: { className?: string } = {}) => <div className={className}>{fixture.filled ? <article><h2>Support the September appeal</h2><p>Help students continue their education.</p></article> : null}</div>}
              variantA={({ className }: { className?: string } = {}) => <div className={className} />}
              variantB={({ className }: { className?: string } = {}) => <div className={className} />}
              variantC={({ className }: { className?: string } = {}) => <div className={className} />}
              puck={{ renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null }} />
        const page = '<!DOCTYPE html>' + renderToStaticMarkup(<html lang="en" data-theme={theme}>
          <head>
            <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>{`Experiment editor — ${state} — ${theme}`}</title>
            <link rel="stylesheet" href={pathToFileURL(hostCss).href} />
            <link rel="stylesheet" href={pathToFileURL(join(source, 'puck/editor/editor.css')).href} />
            <style>{`body { margin: 0; padding: 32px; background: ${theme === 'dark' ? '#141414' : '#fff'}; } main { max-width: 1100px; margin: auto; }`}</style>
          </head>
          <body><main>{content}</main></body>
        </html>)
        const path = join(output, `${state}-${theme}.html`)
        writeFileSync(path, page)
        paths.push(path)
      }
    }
    expect(paths).toHaveLength(8)
  })
})
