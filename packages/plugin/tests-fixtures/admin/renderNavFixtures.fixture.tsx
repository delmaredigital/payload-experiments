// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { Card, ConfigProvider, Link, NavGroup, NavProvider, PreferencesProvider, WindowInfoProvider } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { expect, test, vi } from 'vitest'
import { TestsNavLink } from '../../src/admin/TestsNavLink.js'
import { TestsDashboardCards } from '../../src/admin/TestsDashboardCards.js'

const fixture = vi.hoisted(() => ({ pathname: '/admin/experiments', manager: true }))
// Only supply the auth result to our two components. Payload's real providers,
// NavGroup, Card, Link and their internal hooks remain intact.
vi.mock('@payloadcms/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@payloadcms/ui')>(),
  useAuth: () => ({ permissions: { collections: { 'xp-experiments': { update: fixture.manager } } } }),
}))
// Static HTML has no Next router. Keep Payload's Link rendering, stub routing only.
vi.mock('next/navigation', () => ({
  usePathname: () => fixture.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const require = createRequire(import.meta.url)
const uiEntry = require.resolve('@payloadcms/ui')
const uiDist = uiEntry.slice(0, uiEntry.lastIndexOf('/dist/') + '/dist'.length)
const adminCss = require.resolve('@payloadcms/next/css')
const source = join(dirname(fileURLToPath(import.meta.url)), '../../src/admin')
const config = { collections: [], globals: [], routes: { admin: '/admin', api: '/api' } } as unknown as ClientConfig

// CollectionCards/index.scss, flattened from Payload 3.90.2. Only these fixture
// comparison classes use Payload tokens; the plugin CSS uses its own aliases.
const collectionCss = `
.collections { display: flex; width: 100%; --gap: var(--base); --cols: 5; }
.collections__wrap { width: 100%; display: flex; flex-direction: column; gap: var(--base); }
.collections__group { display: flex; flex-direction: column; gap: var(--gap); }
.collections__label { margin: 0; }
.collections__card-list { padding: 0; margin: 0; list-style: none; gap: 12px; display: grid; grid-template-columns: repeat(var(--cols), 1fr); }
.collections__card-list .card { height: 100%; }
.collections__locked.locked { align-items: unset; justify-content: unset; }
@media (max-width: 1440px) { .collections { --cols: 4; } }
@media (max-width: 1024px) { .collections { --gap: var(--base); --cols: 2; } }
@media (max-width: 768px) { .collections { --cols: 2; } .collections__wrap { gap: var(--base); } .collections__card-list { gap: calc(var(--base) * 0.4); } }
@media (max-width: 400px) { .collections { --cols: 1; } }
`
const entities = [{ slug: 'users', label: 'Users' }, { slug: 'pages', label: 'Pages' }]

function Comparison() {
  return <ConfigProvider config={config}>
    <PreferencesProvider>
      <WindowInfoProvider breakpoints={{ l: '1440px', m: '1024px', s: '768px', xs: '400px' }}>
        <NavProvider initialIsOpen>
          <aside className="nav nav--nav-open"><div className="nav__scroll"><nav className="nav__wrap">
            <TestsNavLink />
            <NavGroup label="Collections">
              {entities.map(({ slug, label }) => <Link className="nav__link" id={`nav-${slug}`} prefetch={false} href={`/admin/collections/${slug}`} key={slug}>
                <span className="nav__link-label">{label}</span>
              </Link>)}
            </NavGroup>
          </nav></div></aside>
          <main className="fixture-dashboard">
            <TestsDashboardCards />
            <div className="collections"><div className="collections__wrap"><div className="collections__group">
              <h2 className="collections__label">Collections</h2>
              <ul className="collections__card-list">{entities.map(({ slug, label }) => <li key={slug}>
                <Card id={`card-${slug}`} title={label} titleAs="h3" buttonAriaLabel={`Show all ${label}`} href={`/admin/collections/${slug}`} />
              </li>)}</ul>
            </div></div></div>
          </main>
        </NavProvider>
      </WindowInfoProvider>
    </PreferencesProvider>
  </ConfigProvider>
}

test('writes real Payload nav and dashboard comparisons in light and dark', () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  const payloadCss = join(uiDist, 'styles.css')
  readFileSync(payloadCss)
  readFileSync(adminCss)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const manager of [true, false]) {
    fixture.manager = manager
    for (const route of (manager ? ['tests', 'goals'] : ['tests']) as Array<'tests' | 'goals'>) {
      fixture.pathname = route === 'tests' ? '/admin/experiments' : '/admin/experiments/goals/new'
      for (const theme of ['light', 'dark']) {
        const html = '<!DOCTYPE html>' + renderToStaticMarkup(<html lang="en" data-theme={theme}>
          <head>
            <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>{`Tests navigation — ${manager ? 'manager' : 'reader'} — ${route} — ${theme}`}</title>
            <link rel="stylesheet" href={pathToFileURL(adminCss).href} />
            <link rel="stylesheet" href={pathToFileURL(payloadCss).href} />
            <link rel="stylesheet" href={pathToFileURL(join(source, 'theme.css')).href} />
            <link rel="stylesheet" href={pathToFileURL(join(source, 'dashboard.css')).href} />
            <style>{collectionCss}</style>
            <style>{`body { display: flex; margin: 0; background: var(--theme-bg); color: var(--theme-text); } aside.nav { position: sticky; top: 0; flex-shrink: 0; } .fixture-dashboard { flex: 1; min-width: 0; padding: 40px; }`}</style>
          </head>
          <body><Comparison /></body>
        </html>)
        expect(html).toContain('nav-group__content')
        expect(html).toContain('card__click')
        if (!manager) {
          expect(html).not.toContain('nav-xp-tests')
          expect(html).not.toContain('xp-dash-group')
          expect(html).toContain('nav-users')
        }
        const path = join(output, `admin-nav-${manager ? 'manager' : 'reader'}-${route}-${theme}.html`)
        writeFileSync(path, html)
        paths.push(path)
      }
    }
  }
  expect(paths).toHaveLength(6)
  console.log(paths.join('\n'))
})
