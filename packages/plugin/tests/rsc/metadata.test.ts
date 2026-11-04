import { requestState, trustedContext } from './requestHarness.js'
import { expect, test } from 'vitest'
import { manifest, page, runtime } from './helpers.js'
import { experimentMetadata } from '../../src/server/metadata.js'

test('live variant gets noindex and control canonical; the control keeps its own canonical; unrelated is empty', async () => {
  const { rt } = runtime(manifest([page()]))
  expect(await experimentMetadata(rt, '/variant')).toEqual({ robots: { index: false }, alternates: { canonical: '/original' } })
  expect(await experimentMetadata(rt, '/original')).toEqual({ alternates: { canonical: '/original' } })
  expect(await experimentMetadata(rt, '/other')).toEqual({})
})
test('archived losing path canonical points to winner, live path takes precedence', async () => {
  const m = manifest([page()]); m.archivedPages = { '/loser': { slug: 'old', winnerPath: '/winner' }, '/original': { slug: 'old', winnerPath: '/winner' } }
  const { rt } = runtime(m)
  expect(await experimentMetadata(rt, '/loser')).toEqual({ alternates: { canonical: '/winner' } })
  expect(await experimentMetadata(rt, '/original')).toEqual({ alternates: { canonical: '/original' } })
})
test('no manifest yields empty metadata', async () => {
  expect(await experimentMetadata(runtime(undefined, { loadManifest: async () => null }).rt, '/variant')).toEqual({})
})


test('live page matching normalises both the target and request paths', async () => {
  const m = manifest([page({ arms: [
    { key: 'control', kind: 'control', weight: 0, pageTarget: '/original/' },
    { key: 'variantA', kind: 'variant', weight: 100, pageTarget: '/variant/' },
  ] })])
  const { rt } = runtime(m)
  expect(await experimentMetadata(rt, '/original')).toEqual({ alternates: { canonical: '/original/' } })
  expect(await experimentMetadata(rt, '/variant')).toEqual({ robots: { index: false }, alternates: { canonical: '/original/' } })
})


test.each(['/old', '/old/'])('archived key /old/ matches normalised request %s', async path => {
  const m = manifest([])
  m.archivedPages['/old/'] = { slug: 'archived', winnerPath: '/winner' }
  expect(await experimentMetadata(runtime(m).rt, path)).toEqual({ alternates: { canonical: '/winner' } })
})

// Metadata receives route params after rewriting, while the proxy signs the original URL.
import { NextRequest } from 'next/server.js'
import { resolveExperiments } from '../../src/proxy/resolve.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { secrets } from './helpers.js'

for (const original of ['/', '/original']) {
  for (const status of ['running', 'decided', 'archived'] as const) {
    test.each(['control', 'variant', 'bot-variant'] as const)(`${original} stays indexable when ${status}, assigned %s`, async visitor => {
      const variant = visitor !== 'control'
      const e = page({ status: status === 'archived' ? 'decided' : status, winnerArm: variant ? 'variantA' : 'control', arms: [
        { key: 'control', kind: 'control', weight: variant ? 0 : 100, pageTarget: original },
        { key: 'variantA', kind: 'variant', weight: variant ? 100 : 0, pageTarget: '/variant' },
      ] })
      const m = manifest(status === 'archived' ? [] : [e])
      if (status === 'archived') m.archivedPages[original] = { slug: e.slug, winnerPath: '/variant' }
      const { rt } = runtime(m)
      const result = await resolveExperiments(new NextRequest(`https://example.test${original}?campaign=test`, { headers: {
        cookie: `xp_id=${encodeUnitCookie('visitor', secrets)}`,
        'user-agent': visitor === 'bot-variant' ? 'Googlebot' : 'Mozilla/5.0',
      } }), rt.proxyRuntime)
      requestState.headers = result.requestHeaders
      const served = result.rewrite ? new URL(result.rewrite).pathname : original
      if (variant) expect(served).toBe('/variant')
      // Served as a variant or not, the Original's URL is indexable with its own canonical while live.
      expect(await experimentMetadata(rt, served)).toEqual(status === 'archived' ? { alternates: { canonical: '/variant' } } : { alternates: { canonical: original } })
    })
  }
}

test('a signed version URL gets noindex even when route params name the Original', async () => {
  trustedContext('/variant/?search=yes', 'GET', true, ['old'])
  expect(await experimentMetadata(runtime(manifest([page()])).rt, '/original')).toEqual({ robots: { index: false }, alternates: { canonical: '/original' } })
})
test('an archived version URL canonicalises to the winner without noindexing the Original', async () => {
  const m = manifest([])
  m.archivedPages = { '/variant': { slug: 'old', winnerPath: '/winner' }, '/original': { slug: 'old', winnerPath: '/winner' } }
  trustedContext('/variant?search=yes')
  expect(await experimentMetadata(runtime(m).rt, '/winner')).toEqual({ alternates: { canonical: '/winner' } })
})
test('a forged request header is ignored in favour of the path argument', async () => {
  trustedContext('/original')
  requestState.headers.set('x-xp-request', requestState.headers.get('x-xp-request')!.replace('/original', '/variant'))
  expect(await experimentMetadata(runtime(manifest([page()])).rt, '/original')).toEqual({ alternates: { canonical: '/original' } })
})
