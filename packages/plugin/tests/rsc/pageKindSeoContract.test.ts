import { requestState, newRequest } from './requestHarness.js'
import { expect, test } from 'vitest'
import { pageKindSeoContract } from '../../src/exports/rsc.js'
import { experimentMetadata } from '../../src/server/metadata.js'
import { experimentSitemapFilter } from '../../src/server/sitemap.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'

for (const original of ['/', '/original']) for (const state of ['running', 'decided', 'archived'] as const) {
  for (const winner of [original, '/variant']) test(`${state} ${original}, winner ${winner}, drives the host runtime's metadata`, async () => {
    const { manifest, rows } = pageKindSeoContract({ secret: 'fixture', original, versions: ['/variant', '/second'], state, winner })
    const runtime = defineExperimentsServerRuntime(defineExperimentsProxyRuntime({ secret: 'fixture', apiRoute: '/api', loadManifest: async () => manifest }), { getPayload: async () => { throw new Error('no database') } })
    if (state === 'running') expect(rows.filter(row => row.requestPath === original).map(row => row.servedPath)).toEqual([original, '/variant', '/second'])
    for (const row of rows) {
      newRequest()
      requestState.headers = new Headers(row.headers)
      const metadata = await experimentMetadata(runtime, row.servedPath)
      expect(metadata.robots).toEqual(row.expect.robots)
      expect(metadata.alternates?.canonical).toEqual(row.expect.canonical)
      expect(experimentSitemapFilter(row.requestPath, manifest)).toBe(row.expect.inSitemap)
    }
  })
}
test('decided and archived require a valid winner', () => {
  expect(() => pageKindSeoContract({ secret: 'fixture', original: '/', versions: ['/v'], state: 'decided' })).toThrow()
  expect(() => pageKindSeoContract({ secret: 'fixture', original: '/', versions: ['/v'], state: 'archived', winner: '/missing' })).toThrow()
})
