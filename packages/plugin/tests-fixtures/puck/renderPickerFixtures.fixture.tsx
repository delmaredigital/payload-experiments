// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
  const source = join(dirname(fileURLToPath(import.meta.url)), '../../src')
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@payloadcms/ui')
  const payloadStyles = [require.resolve('@payloadcms/next/css'), join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css')]
  const adminStyles = [...payloadStyles, ...['admin/theme.css', 'ui/ui.css'].map(path => join(source, path))]
  adminStyles.forEach(path => readFileSync(path))
  // The supplied Puck CSS has no Payload palette. Verify the actual admin
  // styles supply the host variables that the plugin theme aliases.
  type CssNode = { type: string; property?: string; name?: string; children?: { toArray(): CssNode[] } }
  const css = createRequire(require.resolve('jsdom'))('css-tree') as {
    parse(text: string, options?: { parseCustomProperty: boolean }): CssNode
    walk(node: CssNode, visit: (node: CssNode) => void): void
  }
  const defined = new Set<string>()
  for (const path of payloadStyles) css.walk(css.parse(readFileSync(path, 'utf8')), node => {
    if (node.type === 'Declaration') defined.add(node.property!)
  })
  css.walk(css.parse(readFileSync(join(source, 'admin/theme.css'), 'utf8'), { parseCustomProperty: true }), node => {
    if (node.type !== 'Function' || node.name !== 'var') return
    const name = node.children?.toArray()[0]?.name
    if (name && !name.startsWith('--xp-')) expect(defined.has(name), `Missing Payload variable ${name}`).toBe(true)
  })
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
      // The Payload admin layout loads these shared styles in the sidebar document.
      writeFileSync(path, `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Test picker — ${theme} — ${width}</title>
        <link rel="stylesheet" href="${pathToFileURL(hostCss).href}">
        ${adminStyles.map(path => `<link rel="stylesheet" href="${pathToFileURL(path).href}">`).join("\n")}
        <style>body { margin: 0; padding: 24px; background: ${theme === 'dark' ? '#141414' : '#fff'}; }
        aside { width: 300px; max-width: 100%; }</style>
        </head><body><aside>${view.container.innerHTML}</aside></body></html>`)
      const html = readFileSync(path, 'utf8')
      expect(html).toContain('xp-puck-field')
      expect(html).toContain('type="search"')
      const page = new DOMParser().parseFromString(html, 'text/html')
      expect(page.documentElement.dataset.theme).toBe(theme)
      expect([...page.querySelectorAll('link[rel=stylesheet]')].map(link => link.getAttribute('href')))
        .toEqual([hostCss, ...adminStyles].map(path => pathToFileURL(path).href))
      console.log(path)
    }
  }
})
