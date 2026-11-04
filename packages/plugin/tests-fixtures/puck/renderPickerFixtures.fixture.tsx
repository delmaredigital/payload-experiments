// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createExperimentSlotField } from '../../src/puck/experimentSlotField.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('writes a small sidebar picker fixture with search in light and dark', async () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  const hostCss = process.env.XP_HOST_CSS ?? ''
  if (!isAbsolute(hostCss)) throw new Error('XP_HOST_CSS must be an absolute path')
  readFileSync(hostCss)
  const fieldCss = join(dirname(fileURLToPath(import.meta.url)), '../../src/puck/field.css')
  readFileSync(fieldCss)
  const docs = Array.from({ length: 150 }, (_, id) => ({ id, slug: `block-${id + 1}`, name: `Page block test ${id + 1}`, status: 'draft' }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return new Response(JSON.stringify({ docs: docs.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 }))
  }))
  // Render the real sidebar field factory, including its host provider.
  const field = createExperimentSlotField()
  const view = render(field.render({ field, value: { id: 149, slug: 'block-150' }, onChange: () => {}, name: 'experiment', id: 'picker-fixture' }))
  await screen.findByRole('option', { name: 'Page block test 150 · Draft' })
  expect(screen.getAllByRole('option')).toHaveLength(151)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'block-2' } })
  expect(screen.getByRole('option', { name: 'Page block test 150 · Draft' })).toBeTruthy()
  view.container.querySelectorAll('option').forEach(option => option.toggleAttribute('selected', option.selected))
  view.container.querySelectorAll('input').forEach(input => input.setAttribute('value', input.value))
  mkdirSync(output, { recursive: true })
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      const path = join(output, `picker-search-${theme}-${width}.html`)
      // Host document only: no admin theme.css, ui.css or canvas editor.css.
      writeFileSync(path, `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Test picker — ${theme} — ${width}</title>
        <link rel="stylesheet" href="${pathToFileURL(hostCss).href}">
        <link rel="stylesheet" href="${pathToFileURL(fieldCss).href}">
        <style>body { margin: 0; padding: 24px; background: ${theme === 'dark' ? '#141414' : '#fff'}; }
        aside { width: 300px; max-width: 100%; }</style>
        </head><body><aside>${view.container.innerHTML}</aside></body></html>`)
      const html = readFileSync(path, 'utf8')
      expect(html).toContain('xp-puck-field')
      expect(html).toContain('type="search"')
      expect(html).not.toContain('theme.css')
      console.log(path)
    }
  }
})
