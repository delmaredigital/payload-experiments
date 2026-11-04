// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentPicker } from '../../src/puck/ExperimentPicker.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('writes a small sidebar picker fixture with search in light and dark', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/ui.css'), 'utf8')
  const docs = Array.from({ length: 150 }, (_, id) => ({ id, slug: `block-${id + 1}`, name: `Page block test ${id + 1}`, status: 'draft' }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return new Response(JSON.stringify({ docs: docs.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 }))
  }))
  const view = render(<ExperimentPicker value={{ id: 149, slug: 'block-150' }} onChange={() => {}} />)
  await screen.findByRole('option', { name: 'Page block test 150 · Draft' })
  expect(screen.getAllByRole('option')).toHaveLength(151)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'block-2' } })
  expect(screen.getByRole('option', { name: 'Page block test 150 · Draft' })).toBeTruthy()
  view.container.querySelectorAll('option').forEach(option => option.toggleAttribute('selected', option.selected))
  view.container.querySelectorAll('input').forEach(input => input.setAttribute('value', input.value))
  mkdirSync(output, { recursive: true })
  for (const theme of ['light', 'dark']) {
    const path = join(output, `picker-search-${theme}.html`)
    writeFileSync(path, `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><title>Test picker — ${theme}</title><style>${css}</style><style>body { margin: 0; padding: 24px; background: ${theme === 'dark' ? '#141414' : '#fff'}; color: ${theme === 'dark' ? '#eee' : '#222'}; font: 14px system-ui; } aside { width: 300px; }</style></head><body><aside>${view.container.innerHTML}</aside></body></html>`)
    console.log(path)
  }
})
