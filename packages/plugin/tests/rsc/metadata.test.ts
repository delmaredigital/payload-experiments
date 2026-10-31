import { expect, test } from 'vitest'
import { manifest, page, runtime } from './helpers.js'
import { experimentMetadata } from '../../src/server/metadata.js'

test('live variant gets noindex and control canonical; control/unrelated are empty', async () => {
  const { rt } = runtime(manifest([page()]))
  expect(await experimentMetadata(rt, '/variant')).toEqual({ robots: { index: false }, alternates: { canonical: '/original' } })
  expect(await experimentMetadata(rt, '/original')).toEqual({})
  expect(await experimentMetadata(rt, '/other')).toEqual({})
})
test('archived losing path canonical points to winner, live path takes precedence', async () => {
  const m = manifest([page()]); m.archivedPages = { '/loser': { slug: 'old', winnerPath: '/winner' }, '/original': { slug: 'old', winnerPath: '/winner' } }
  const { rt } = runtime(m)
  expect(await experimentMetadata(rt, '/loser')).toEqual({ alternates: { canonical: '/winner' } })
  expect(await experimentMetadata(rt, '/original')).toEqual({})
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
  expect(await experimentMetadata(rt, '/original')).toEqual({})
  expect(await experimentMetadata(rt, '/variant')).toEqual({ robots: { index: false }, alternates: { canonical: '/original/' } })
})
